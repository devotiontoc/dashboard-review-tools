document.addEventListener('DOMContentLoaded', function() {
    // --- Element References ---
    const prSelect = document.getElementById('pr-select');
    const fetchButton = document.getElementById('fetch-button');
    const loader = document.getElementById('loader');
    const dashboardContent = document.getElementById('dashboard-content');
    const errorDisplay = document.getElementById('error-display');
    const historySection = document.getElementById('history-section');
    const findingsContainer = document.getElementById('detailed-findings');
    const viewSideBySideBtn = document.getElementById('view-side-by-side');
    const viewUnifiedBtn = document.getElementById('view-unified');

    // --- State Management ---
    let activeCharts = [];
    let currentViewMode = 'side-by-side';
    let currentAnalysisResults = null;
    let toolColorMap = new Map();

    // --- High-Contrast Color Palette ---
    const DISTINCT_COLORS = [
        '#5A87C5', '#E67E22', '#2ECC71', '#9B59B6', '#F1C40F',
        '#1ABC9C', '#E74C3C', '#3498DB', '#7F8C8D', '#D35400'
    ];

    /**
     * Unique color for each tool by iterating through the palette.
     */
    function assignToolColors(toolNames) {
        toolColorMap.clear();
        toolNames.forEach((toolName, index) => {
            // Use the tool's index to pick a color, wrapping around if the palette is smaller.
            const color = DISTINCT_COLORS[index % DISTINCT_COLORS.length];
            toolColorMap.set(toolName, color);
        });
    }

    function getToolColor(toolName) {
        return toolColorMap.get(toolName) || '#7F8C8D'; // Return gray as a fallback
    }

    async function getPullRequests() {
        try {
            const response = await fetch('/api/get-pull-requests');
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to fetch PRs.');
            const prs = await response.json();

            if (prs.length > 0) {
                prSelect.innerHTML = prs.map(pr => `<option value="${pr.number}">#${pr.number}: ${pr.title}</option>`).join('');
                fetchButton.disabled = false;
                fetchButton.textContent = "Fetch Analysis";
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
        dashboardContent.style.display = 'none';
        errorDisplay.style.display = 'none';

        activeCharts.forEach(chart => chart.destroy());
        activeCharts = [];

        try {
            const response = await fetch(`/api/aggregate-pr?pr=${prNumber}`);
            if (!response.ok) throw new Error((await response.json()).error || `Aggregation failed.`);

            currentAnalysisResults = await response.json();
            saveAnalysis(currentAnalysisResults);
            renderAll();
            dashboardContent.style.display = 'block';

        } catch (error) {
            showError(`An error occurred while analyzing PR #${prNumber}: ${error.message}`);
        } finally {
            loader.style.display = 'none';
            fetchButton.disabled = false;
        }
    });

    function renderAll() {
        if (!currentAnalysisResults) return;
        renderCharts(currentAnalysisResults);
        renderFindings(currentAnalysisResults);
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
            renderHistory();
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

            historySection.style.display = 'block';

            const tools = [...new Set(historyData.map(d => d.tool_name))];
            const labels = [...new Set(historyData.map(d => new Date(d.timestamp).toLocaleDateString()))].sort((a,b) => new Date(a) - new Date(b));

            const datasetsFindings = tools.map(tool => ({
                label: tool,
                data: labels.map(label => historyData.find(d => new Date(d.timestamp).toLocaleDateString() === label && d.tool_name === tool)?.finding_count || null),
                borderColor: getToolColor(tool),
                tension: 0.1,
                spanGaps: true
            }));

            const datasetsNovelty = tools.map(tool => ({
                label: tool,
                data: labels.map(label => historyData.find(d => new Date(d.timestamp).toLocaleDateString() === label && d.tool_name === tool)?.novelty_score || null),
                borderColor: getToolColor(tool),
                tension: 0.1,
                spanGaps: true
            }));

            activeCharts.push(new Chart(document.getElementById('historyFindingsChart'), { type: 'line', data: { labels, datasets: datasetsFindings } }));
            activeCharts.push(new Chart(document.getElementById('historyNoveltyChart'), { type: 'line', data: { labels, datasets: datasetsNovelty } }));

        } catch (error) {
            console.error("Could not render history:", error);
        }
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

    function renderCharts(results) {
        const { tool_names } = results.metadata;
        const {
            findings_by_tool, findings_by_category, comment_verbosity,
            findings_by_file, review_speed, suggestion_overlap,
            novelty_score, findings_density, tool_strength_profile
        } = results.summary_charts;

        assignToolColors(tool_names);
        const dynamicColors = tool_names.map(name => getToolColor(name));

        const commonChartOptions = (indexAxis = 'x') => ({ indexAxis, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#9CA3AF' }, grid: { color: 'rgba(55, 65, 81, 0.5)' } }, y: { ticks: { color: '#9CA3AF' }, grid: { color: 'rgba(55, 65, 81, 0.5)' } } } });

        activeCharts.push(new Chart(document.getElementById('findingsByToolChart'), { type: 'bar', data: { labels: tool_names, datasets: [{ label: 'Number of Findings', data: findings_by_tool, backgroundColor: dynamicColors }] }, options: commonChartOptions('y') }));
        activeCharts.push(new Chart(document.getElementById('findingsByCategoryChart'), { type: 'doughnut', data: { labels: findings_by_category.labels, datasets: [{ data: findings_by_category.data, backgroundColor: ['#991B1B', '#166534', '#9A3412', '#1E40AF'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { color: '#D1D5DB' } } } } }));
        activeCharts.push(new Chart(document.getElementById('findingsByFileChart'), { type: 'bar', data: { labels: findings_by_file.labels, datasets: [{ label: 'Number of Findings', data: findings_by_file.data, backgroundColor: '#A78BFA' }] }, options: commonChartOptions('y') }));

        // ✅ FIX: Ensure labels and data are valid arrays before creating charts.
        activeCharts.push(new Chart(document.getElementById('commentVerbosityChart'), { type: 'bar', data: { labels: comment_verbosity?.labels || [], datasets: [{ label: 'Average Characters per Comment', data: comment_verbosity?.data || [], backgroundColor: dynamicColors }] }, options: commonChartOptions() }));
        activeCharts.push(new Chart(document.getElementById('reviewSpeedChart'), { type: 'bar', data: { labels: review_speed?.labels || [], datasets: [{ label: 'Avg Time to Comment (s)', data: review_speed?.data || [], backgroundColor: dynamicColors }] }, options: commonChartOptions() }));

        const topOverlaps = suggestion_overlap.filter(item => item.sets.length > 1).sort((a, b) => b.size - a.size).slice(0, 3);
        if (topOverlaps.length > 0) { activeCharts.push(new Chart(document.getElementById('suggestionOverlapChart'), { type: 'bar', data: { labels: topOverlaps.map(d => d.sets.join(' & ')), datasets: [{ label: 'Overlapping Findings', data: topOverlaps.map(d => d.size), backgroundColor: '#F87171' }] }, options: commonChartOptions('y') })); }
        activeCharts.push(new Chart(document.getElementById('noveltyScoreChart'), { type: 'bar', data: { labels: tool_names, datasets: [{ label: 'Novelty Score (%)', data: novelty_score, backgroundColor: dynamicColors }] }, options: { ...commonChartOptions(), plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.raw}% Unique` } } } } }));
        activeCharts.push(new Chart(document.getElementById('findingsDensityChart'), { type: 'bar', data: { labels: tool_names, datasets: [{ label: 'Findings per 100 LoC', data: findings_density, backgroundColor: dynamicColors }] }, options: { ...commonChartOptions(), plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.raw.toFixed(2)} / 100 LoC` } } } } }));
        activeCharts.push(new Chart(document.getElementById('toolStrengthChart'), { type: 'bar', data: { labels: tool_strength_profile.tool_names, datasets: tool_strength_profile.categories.map((cat, i) => ({ label: cat, data: tool_strength_profile.data.map(toolData => toolData[i]), backgroundColor: ['#991B1B', '#166534', '#9A3412', '#1E40AF'][i] })) }, options: { ...commonChartOptions(), scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { display: true, position: 'bottom' } } } }));
    }

    function renderFindings(results) {
        while(findingsContainer.children.length > 1) {
            findingsContainer.removeChild(findingsContainer.lastChild);
        }
        if (!results?.findings || results.findings.length === 0) {
            const p = document.createElement('p');
            p.className = 'no-data-message';
            p.textContent = 'No findings were reported for this pull request.';
            findingsContainer.appendChild(p);
            return;
        }

        results.findings.forEach(finding => {
            const hasSuggestion = finding.reviews.some(r => r.suggested_code);
            if (currentViewMode === 'unified' && hasSuggestion) {
                findingsContainer.appendChild(renderUnifiedDiffCard(finding));
            } else {
                findingsContainer.appendChild(renderSideBySideCard(finding));
            }
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
                diffHTML = Diff2Html.html(`--- a\n+++ b\n${review.original_code.split('\n').map(l=>`-${l}`).join('\n')}\n${review.suggested_code.split('\n').map(l=>`+${l}`).join('\n')}`, { drawFileList: false, matching: 'lines', outputFormat: 'side-by-side' });
            }
            reviewsHTML += `<div class="tool-review"><h4 style="border-color: ${toolColor};"><span>${review.tool}</span>${noveltyBadge}</h4><blockquote>${escapeHtml(review.comment)}</blockquote>${diffHTML ? `<div class="diff-container">${diffHTML}</div>` : ''}</div>`;
        });
        card.innerHTML = `<div class="finding-card-header"><h3><code>${finding.location}</code></h3><span class="category ${finding.category.toLowerCase().replace(/ /g, '-')}">${finding.category}</span></div><div class="finding-card-body">${reviewsHTML}</div>`;
        return card;
    }

    function renderUnifiedDiffCard(finding) {
        const card = document.createElement('div');
        card.className = 'finding-card';
        const reviewsWithSuggestions = finding.reviews.filter(r => r.suggested_code);
        const reviewsWithoutSuggestions = finding.reviews.filter(r => !r.suggested_code);

        let unifiedDiffHTML = '';
        if (reviewsWithSuggestions.length > 0) {
            const originalCode = reviewsWithSuggestions[0].original_code || '';
            let diffTable = `<table class="unified-diff-table"><tbody>`;
            originalCode.split('\n').forEach(line => {
                diffTable += `<tr><td class="line-num">-</td><td colspan="2"><code>${escapeHtml(line)}</code></td></tr>`;
            });
            reviewsWithSuggestions.forEach(review => {
                const toolColor = getToolColor(review.tool);
                review.suggested_code.split('\n').forEach((line, i) => {
                    const toolName = i === 0 ? `<span style="color:${toolColor}; font-weight:bold;">${review.tool}</span>` : '';
                    diffTable += `<tr><td class="line-num">+</td><td class="tool-name-cell">${toolName}</td><td><code>${escapeHtml(line)}</code></td></tr>`;
                });
            });
            diffTable += `</tbody></table>`;
            unifiedDiffHTML = diffTable;
        }

        let otherCommentsHTML = '';
        if(reviewsWithoutSuggestions.length > 0) {
            otherCommentsHTML = '<div class="other-comments-container">';
            reviewsWithoutSuggestions.forEach(review => {
                const toolColor = getToolColor(review.tool);
                const noveltyBadge = review.is_novel ? '<span class="novelty-badge">✨ Novel</span>' : '';
                otherCommentsHTML += `<div class="tool-review-small"><h4 style="border-color: ${toolColor};"><span>${review.tool}</span>${noveltyBadge}</h4><blockquote>${escapeHtml(review.comment)}</blockquote></div>`;
            });
            otherCommentsHTML += '</div>';
        }

        card.innerHTML = `<div class="finding-card-header"><h3><code>${finding.location}</code></h3><span class="category ${finding.category.toLowerCase().replace(/ /g, '-')}">${finding.category}</span></div><div class="finding-card-body unified">${unifiedDiffHTML}${otherCommentsHTML}</div>`;
        return card;
    }

    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') { return ''; }
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // --- Initial Load ---
    getPullRequests();
    renderHistory();
});
