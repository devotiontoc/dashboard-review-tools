document.addEventListener('DOMContentLoaded', function() {
    // --- Element References ---
    const prSelect = document.getElementById('pr-select');
    const fetchButton = document.getElementById('fetch-button');
    const loader = document.getElementById('loader');
    const errorDisplay = document.getElementById('error-display');
    const navLinks = document.querySelectorAll('.nav-link');
    const views = document.querySelectorAll('.app-view');
    const findingsContainer = document.getElementById('detailed-findings-container');
    const viewSideBySideBtn = document.getElementById('view-side-by-side');
    const viewUnifiedBtn = document.getElementById('view-unified');

    // --- KPIs ---
    const kpiTotalFindings = document.getElementById('kpi-total-findings');
    const kpiLinesAnalyzed = document.getElementById('kpi-lines-analyzed');
    const kpiAvgNovelty = document.getElementById('kpi-avg-novelty');

    // --- State Management ---
    let activeCharts = [];
    let currentViewMode = 'side-by-side';
    let currentAnalysisResults = null;
    let toolColorMap = new Map();

    // --- High-Contrast Color Palette ---
    const DISTINCT_COLORS = [
        '#58A6FF', '#F778BA', '#3FB950', '#A371F7', '#F0B939',
        '#48D9A4', '#FF8272', '#61DBFB', '#8B949E', '#E4894E'
    ];

    function assignToolColors(toolNames) {
        toolColorMap.clear();
        toolNames.forEach((toolName, index) => {
            const color = DISTINCT_COLORS[index % DISTINCT_COLORS.length];
            toolColorMap.set(toolName, color);
        });
    }

    function getToolColor(toolName) {
        return toolColorMap.get(toolName) || '#8B949E';
    }

    // --- Navigation ---
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = link.getAttribute('data-view');
            switchView(targetView);
        });
    });

    function switchView(viewName) {
        // Hide all views
        views.forEach(view => view.style.display = 'none');
        // Show target view
        document.getElementById(`view-${viewName}`).style.display = 'block';

        // Update active link
        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('data-view') === viewName);
        });
    }

    // --- API & Data Handling ---
    async function getPullRequests() {
        try {
            const response = await fetch('/api/get-pull-requests');
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to fetch PRs.');
            const prs = await response.json();

            if (prs.length > 0) {
                prSelect.innerHTML = prs.map(pr => `<option value="${pr.number}">#${pr.number}: ${pr.title}</option>`).join('');
                fetchButton.querySelector('span').textContent = "Fetch Analysis";
                fetchButton.disabled = false;
            } else {
                prSelect.innerHTML = `<option value="">No open PRs found</option>`;
                fetchButton.disabled = true;
            }
        } catch (error) {
            showError(`Could not load Pull Requests: ${error.message}`);
        }
    }

    fetchButton.addEventListener('click', async () => {
        const prNumber = prSelect.value;
        if (!prNumber) return;

        loader.style.display = 'block';
        fetchButton.disabled = true;
        errorDisplay.style.display = 'none';

        // Clear previous results
        activeCharts.forEach(chart => chart.destroy());
        activeCharts = [];

        try {
            const response = await fetch(`/api/aggregate-pr?pr=${prNumber}`);
            if (!response.ok) throw new Error((await response.json()).error || `Aggregation failed.`);
            currentAnalysisResults = await response.json();

            // Render all data and switch to dashboard view
            renderAll(currentAnalysisResults);
            switchView('dashboard');

            // Asynchronously save and update history
            saveAnalysis(currentAnalysisResults).then(renderHistory);

        } catch (error) {
            showError(`An error analyzing PR #${prNumber}: ${error.message}`);
            switchView('initial'); // Revert to initial view on error
        } finally {
            loader.style.display = 'none';
            fetchButton.disabled = false;
        }
    });

    function renderAll(results) {
        if (!results) return;
        assignToolColors(results.metadata.tool_names);
        renderKPIs(results);
        renderCharts(results);
        renderFindings(results); // Pre-render findings for when user navigates
    }

    async function saveAnalysis(results) {
        try {
            await fetch('/api/save-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pr_number: results.metadata.pr_number,
                    tool_names: results.metadata.tool_names,
                    summary_charts: results.summary_charts
                })
            });
        } catch (error) {
            console.error("Could not save analysis results:", error);
        }
    }

    async function renderHistory() {
        try {
            const response = await fetch('/api/get-history');
            if (!response.ok) return;
            const historyData = await response.json();
            if (historyData.length === 0) return;

            const tools = [...new Set(historyData.map(d => d.tool_name))];
            assignToolColors(tools); // Ensure colors are consistent

            const labels = [...new Set(historyData.map(d => new Date(d.timestamp).toLocaleDateString()))].sort((a,b) => new Date(a) - new Date(b));

            const createDataset = (metric) => tools.map(tool => ({
                label: tool,
                data: labels.map(label => {
                    const entry = historyData.find(d => new Date(d.timestamp).toLocaleDateString() === label && d.tool_name === tool);
                    return entry ? entry[metric] : null;
                }),
                borderColor: getToolColor(tool),
                backgroundColor: getToolColor(tool),
                tension: 0.2,
                spanGaps: true
            }));

            const commonOptions = { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: 'var(--color-text-secondary)' }, grid: { color: 'var(--color-border)' } }, y: { ticks: { color: 'var(--color-text-secondary)' }, grid: { color: 'var(--color-border)' } } }, plugins: { legend: { labels: { color: 'var(--color-text-primary)' } } } };

            activeCharts.push(new Chart(document.getElementById('historyFindingsChart'), { type: 'line', data: { labels, datasets: createDataset('finding_count') }, options: commonOptions }));
            activeCharts.push(new Chart(document.getElementById('historyNoveltyChart'), { type: 'line', data: { labels, datasets: createDataset('novelty_score') }, options: commonOptions }));

        } catch (error) {
            console.error("Could not render history:", error);
        }
    }

    // --- Rendering Functions ---
    function renderKPIs(results) {
        const { summary_charts, metadata } = results;
        kpiTotalFindings.textContent = summary_charts.findings_by_tool.reduce((a, b) => a + b, 0);
        kpiLinesAnalyzed.textContent = metadata.lines_changed;
        const avgNovelty = summary_charts.novelty_score.reduce((a, b) => a + b, 0) / summary_charts.novelty_score.length;
        kpiAvgNovelty.textContent = `${avgNovelty.toFixed(0)}%`;
    }

    function renderCharts(results) {
        const { tool_names } = results.metadata;
        const { findings_by_tool, findings_by_category, novelty_score, findings_density, tool_strength_profile } = results.summary_charts;
        const dynamicColors = tool_names.map(name => getToolColor(name));
        const categoryColors = ['#DA3633', '#238636', '#D73A49', '#1F6FEB'];

        const commonOptions = (legendDisplay = false) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: legendDisplay, labels: { color: 'var(--color-text-primary)'} } }, scales: { x: { ticks: { color: 'var(--color-text-secondary)' }, grid: { color: 'var(--color-border)' } }, y: { beginAtZero: true, ticks: { color: 'var(--color-text-secondary)' }, grid: { color: 'var(--color-border)' } } } });

        activeCharts.push(new Chart(document.getElementById('findingsByToolChart'), { type: 'bar', data: { labels: tool_names, datasets: [{ label: 'Findings', data: findings_by_tool, backgroundColor: dynamicColors }] }, options: commonOptions() }));
        activeCharts.push(new Chart(document.getElementById('findingsByCategoryChart'), { type: 'doughnut', data: { labels: findings_by_category.labels, datasets: [{ data: findings_by_category.data, backgroundColor: categoryColors }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'right', labels: { color: 'var(--color-text-primary)' } } } } }));
        activeCharts.push(new Chart(document.getElementById('noveltyScoreChart'), { type: 'bar', data: { labels: tool_names, datasets: [{ label: 'Novelty Score (%)', data: novelty_score, backgroundColor: dynamicColors }] }, options: commonOptions() }));
        activeCharts.push(new Chart(document.getElementById('findingsDensityChart'), { type: 'bar', data: { labels: tool_names, datasets: [{ label: 'Findings per 100 LoC', data: findings_density, backgroundColor: dynamicColors }] }, options: commonOptions() }));

        activeCharts.push(new Chart(document.getElementById('toolStrengthChart'), {
            type: 'bar',
            data: {
                labels: tool_strength_profile.tool_names,
                datasets: tool_strength_profile.categories.map((cat, i) => ({
                    label: cat,
                    data: tool_strength_profile.data.map(toolData => toolData[i]),
                    backgroundColor: categoryColors[i % categoryColors.length]
                }))
            },
            options: { ...commonOptions(true), scales: { x: { stacked: true, ticks: { color: 'var(--color-text-secondary)' }, grid: { color: 'var(--color-border)' } }, y: { stacked: true, ticks: { color: 'var(--color-text-secondary)' }, grid: { color: 'var(--color-border)' } } } }
        }));
    }

    viewSideBySideBtn.addEventListener('click', () => {
        currentViewMode = 'side-by-side';
        viewSideBySideBtn.classList.add('active');
        viewUnifiedBtn.classList.remove('active');
        renderFindings(currentAnalysisResults);
    });

    viewUnifiedBtn.addEventListener('click', () => {
        currentViewMode = 'unified';
        viewUnifiedBtn.classList.add('active');
        viewSideBySideBtn.classList.remove('active');
        renderFindings(currentAnalysisResults);
    });

    function renderFindings(results) {
        findingsContainer.innerHTML = ''; // Clear previous
        if (!results?.findings || results.findings.length === 0) {
            findingsContainer.innerHTML = '<p class="no-data-message">No findings were reported for this pull request.</p>';
            return;
        }

        results.findings.forEach(finding => {
            const hasSuggestion = finding.reviews.some(r => r.suggested_code);
            const card = (currentViewMode === 'unified' && hasSuggestion) ? renderUnifiedDiffCard(finding) : renderSideBySideCard(finding);
            findingsContainer.appendChild(card);
        });
    }

    function renderSideBySideCard(finding) {
        const card = document.createElement('div');
        card.className = 'finding-card';
        let reviewsHTML = '';
        finding.reviews.forEach(review => {
            const toolColor = getToolColor(review.tool);
            const noveltyBadge = review.is_novel ? '<span class="novelty-badge">✨ Novel</span>' : '';
            let diffHTML = '';
            if (review.original_code && review.suggested_code) {
                const diffString = `--- a\n+++ b\n${review.original_code.split('\n').map(l => `-${l}`).join('\n')}\n${review.suggested_code.split('\n').map(l => `+${l}`).join('\n')}`;
                diffHTML = Diff2Html.html(diffString, { drawFileList: false, matching: 'lines', outputFormat: 'side-by-side' });
            }
            const commentText = escapeHtml(review.comment.replace(/```(suggestion|diff)[\s\S]*?```/s, ''));
            reviewsHTML += `
                <div class="tool-review">
                    <h4 style="border-color: ${toolColor};"><span>${review.tool}</span>${noveltyBadge}</h4>
                    <blockquote>${commentText}</blockquote>
                    ${diffHTML ? `<div class="diff-container">${diffHTML}</div>` : ''}
                </div>`;
        });
        card.innerHTML = `
            <div class="finding-card-header">
                <h3><code>${finding.location}</code></h3>
                <span class="category ${finding.category.toLowerCase().replace(/\s+/g, '-')}">${finding.category}</span>
            </div>
            <div class="finding-card-body">${reviewsHTML}</div>`;
        return card;
    }

    function renderUnifiedDiffCard(finding) {
        const card = document.createElement('div');
        card.className = 'finding-card';
        const reviewsWithSuggestions = finding.reviews.filter(r => r.suggested_code);
        const reviewsWithoutSuggestions = finding.reviews.filter(r => !r.suggested_code);
        const originalCode = reviewsWithSuggestions[0]?.original_code || '';

        let unifiedDiffHTML = `<div class="unified-diff-container"><table class="unified-diff-table"><tbody>`;
        originalCode.split('\n').forEach(line => {
            unifiedDiffHTML += `<tr class="line-orig"><td class="line-num">-</td><td class="tool-name-cell"></td><td class="line-code">${escapeHtml(line)}</td></tr>`;
        });
        reviewsWithSuggestions.forEach(review => {
            const toolColor = getToolColor(review.tool);
            review.suggested_code.split('\n').forEach((line, i) => {
                const toolName = i === 0 ? `<span style="color:${toolColor};">${review.tool}</span>` : '';
                unifiedDiffHTML += `<tr class="line-sugg"><td class="line-num">+</td><td class="tool-name-cell">${toolName}</td><td class="line-code">${escapeHtml(line)}</td></tr>`;
            });
        });
        unifiedDiffHTML += `</tbody></table></div>`;

        let otherCommentsHTML = '';
        if (reviewsWithoutSuggestions.length > 0) {
            otherCommentsHTML = '<div class="other-comments-container"><h5>Additional Comments</h5>';
            reviewsWithoutSuggestions.forEach(review => {
                const toolColor = getToolColor(review.tool);
                const noveltyBadge = review.is_novel ? '<span class="novelty-badge">✨ Novel</span>' : '';
                otherCommentsHTML += `
                    <div class="tool-review-small" style="border-color: ${toolColor};">
                        <h4><span>${review.tool}</span>${noveltyBadge}</h4>
                        <blockquote>${escapeHtml(review.comment)}</blockquote>
                    </div>`;
            });
            otherCommentsHTML += '</div>';
        }

        card.innerHTML = `
            <div class="finding-card-header">
                <h3><code>${finding.location}</code></h3>
                <span class="category ${finding.category.toLowerCase().replace(/ /g, '-')}">${finding.category}</span>
            </div>
            <div class="finding-card-body unified">${unifiedDiffHTML}${otherCommentsHTML}</div>`;
        return card;
    }

    function showError(message) {
        errorDisplay.textContent = message;
        errorDisplay.style.display = 'block';
    }

    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // --- Initial Load ---
    getPullRequests();
    renderHistory(); // Attempt to render history on page load
    switchView('initial');
});