document.addEventListener('DOMContentLoaded', () => {
    // =================================================================
    // 1. APPLICATION STATE & CONFIGURATION
    // =================================================================
    let currentAnalysisResults = null;
    let activeCharts = {}; // Use an object to name charts for easier updates
    let toolColorMap = new Map();
    let currentFindingsViewMode = 'side-by-side';
    let activeFilters = {
        tools: new Set(),
        category: null,
    };

    // =================================================================
    // 2. ELEMENT SELECTORS
    // =================================================================
    const prSelect = document.getElementById('pr-select');
    const fetchButton = document.getElementById('fetch-button');
    const loader = document.getElementById('loader');
    const errorDisplay = document.getElementById('error-display');
    const dashboardControls = document.getElementById('dashboard-controls');
    const toolFilterContainer = document.getElementById('tool-filter-container');
    const exportButton = document.getElementById('export-csv-button');
    const navLinks = document.querySelectorAll('.nav-link');
    const views = document.querySelectorAll('.app-view');
    const tabs = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const findingsContainer = document.getElementById('detailed-findings-container');
    const viewSideBySideBtn = document.getElementById('view-side-by-side');
    const viewUnifiedBtn = document.getElementById('view-unified');
    const kpiTotalFindings = document.getElementById('kpi-total-findings');
    const kpiLinesAnalyzed = document.getElementById('kpi-lines-analyzed');
    const kpiAvgNovelty = document.getElementById('kpi-avg-novelty');

    // =================================================================
    // 3. CORE LOGIC & DATA HANDLING
    // =================================================================

    async function fetchAnalysis() {
        toggleLoading(true);
        showSkeletons(true);

        try {
            const prNumber = prSelect.value;
            if (!prNumber) return;

            const response = await fetch(`/api/aggregate-pr?pr=${prNumber}`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Aggregation failed.');
            }

            currentAnalysisResults = await response.json();

            // MASTER GUARD CLAUSE: Ensure the core data structure is present.
            if (!currentAnalysisResults?.metadata || !currentAnalysisResults?.summary_charts || !currentAnalysisResults?.findings) {
                throw new Error("Received incomplete or malformed analysis data from the API.");
            }

            activeFilters.tools = new Set(currentAnalysisResults.metadata.tool_names);
            activeFilters.category = null;

            renderUI();

        } catch (error) {
            showError(`Failed to analyze PR: ${error.message}`);
            switchView('initial');
        } finally {
            toggleLoading(false);
            showSkeletons(false);
        }
    }

    async function getPullRequests() {
        try {
            const response = await fetch('/api/get-pull-requests');
            if (!response.ok) throw new Error('Failed to fetch pull requests.');
            const prs = await response.json();
            prSelect.innerHTML = prs.length > 0
                ? prs.map(pr => `<option value="${pr.number}">#${pr.number}: ${pr.title}</option>`).join('')
                : `<option value="">No open PRs found</option>`;
            fetchButton.disabled = prs.length === 0;
        } catch (error) {
            showError(error.message);
        }
    }

    function exportData() {
        if (!currentAnalysisResults?.findings) {
            showError("No data available to export.");
            return;
        }
        let csvContent = "data:text/csv;charset=utf-8,Location,Category,Tool,Is Novel,Comment\n";
        currentAnalysisResults.findings.forEach(finding => {
            finding.reviews.forEach(review => {
                const row = [
                    `"${finding.location.replace(/"/g, '""')}"`,
                    `"${finding.category.replace(/"/g, '""')}"`,
                    `"${review.tool.replace(/"/g, '""')}"`,
                    review.is_novel,
                    `"${review.comment.replace(/"/g, '""').replace(/\n/g, ' ')}"`
                ].join(",");
                csvContent += row + "\n";
            });
        });
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", `pr-${currentAnalysisResults.metadata.pr_number}-findings.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // =================================================================
    // 4. UI RENDERING & MANAGEMENT
    // =================================================================

    function renderUI() {
        if (!currentAnalysisResults) return;
        switchView('dashboard');
        switchTab('overview');
        dashboardControls.style.display = 'flex';
        renderFilters(currentAnalysisResults.metadata.tool_names, activeFilters.tools);
        updateKPIs(currentAnalysisResults, activeFilters);
        renderFindings(currentAnalysisResults, activeFilters);
        renderCharts(currentAnalysisResults, activeFilters);
    }

    function toggleLoading(isLoading) {
        if (loader) loader.style.display = isLoading ? 'block' : 'none';
        if (fetchButton) fetchButton.disabled = isLoading;
        if (isLoading) showError('');
    }

    function showError(message) {
        if (errorDisplay) {
            errorDisplay.textContent = message;
            errorDisplay.style.display = message ? 'block' : 'none';
        }
    }

    function switchView(viewName) {
        views.forEach(view => view.classList.remove('active'));
        document.getElementById(`view-${viewName}`)?.classList.add('active');
        navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('data-view') === viewName));
    }

    function switchTab(tabName) {
        tabContents.forEach(content => content.classList.remove('active'));
        document.getElementById(`tab-${tabName}`)?.classList.add('active');
        tabs.forEach(tab => tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName));
    }

    function renderFilters(toolNames, activeTools) {
        if (!toolFilterContainer) return;
        toolFilterContainer.innerHTML = '<label>Filter by Tool:</label>';
        toolNames.forEach(tool => {
            const isChecked = activeTools.has(tool);
            toolFilterContainer.insertAdjacentHTML('beforeend', `
                <label class="filter-checkbox">
                    <input type="checkbox" data-tool="${tool}" ${isChecked ? 'checked' : ''}>
                    <span>${tool}</span>
                </label>`);
        });
        toolFilterContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const selectedTools = new Set(Array.from(toolFilterContainer.querySelectorAll('input:checked')).map(cb => cb.dataset.tool));
                activeFilters.tools = selectedTools;
                renderUI();
            });
        });
    }

    function updateKPIs(results, filters) {
        if (!results.findings) return;
        const filteredFindings = results.findings.flatMap(f => f.reviews).filter(r => filters.tools.has(r.tool));
        const totalFindings = filteredFindings.length;
        const novelScores = filteredFindings.filter(r => r.is_novel).length;
        const avgNovelty = totalFindings > 0 ? (novelScores / totalFindings) * 100 : 0;
        if (kpiTotalFindings) kpiTotalFindings.textContent = totalFindings;
        if (kpiLinesAnalyzed) kpiLinesAnalyzed.textContent = results.metadata.lines_changed;
        if (kpiAvgNovelty) kpiAvgNovelty.textContent = `${avgNovelty.toFixed(0)}%`;
    }

    function renderFindings(results, filters) {
        if (!findingsContainer) return;
        findingsContainer.innerHTML = '';
        const filteredFindings = results.findings
            .map(finding => ({...finding, reviews: finding.reviews.filter(review => filters.tools.has(review.tool))}))
            .filter(finding => finding.reviews.length > 0);

        if (filteredFindings.length === 0) {
            findingsContainer.innerHTML = '<p class="no-data-message">No findings match the current filters.</p>';
            return;
        }
        filteredFindings.forEach(finding => {
            const hasSuggestion = finding.reviews.some(r => r.suggested_code);
            const card = (currentFindingsViewMode === 'unified' && hasSuggestion) ? createUnifiedCard(finding) : createSideBySideCard(finding);
            findingsContainer.appendChild(card);
        });
    }

    function createSideBySideCard(finding) {
        const card = document.createElement('div');
        card.className = 'finding-card';
        let reviewsHTML = '';
        finding.reviews.forEach(review => {
            const toolColor = toolColorMap.get(review.tool) || '#8B949E';
            const noveltyBadge = review.is_novel ? '<span class="novelty-badge">✨ Novel</span>' : '';
            let diffHTML = '';
            if (review.original_code && review.suggested_code) {
                const diffString = `--- a\n+++ b\n${review.original_code.split('\n').map(l => `-${l}`).join('\n')}\n${review.suggested_code.split('\n').map(l => `+${l}`).join('\n')}`;
                diffHTML = Diff2Html.html(diffString, {
                    drawFileList: false,
                    matching: 'lines',
                    outputFormat: 'side-by-side'
                });
            }
            const commentText = escapeHtml(review.comment.replace(/```(suggestion|diff)[\s\S]*?```/s, ''));
            reviewsHTML += `
                <div class="tool-review">
                    <h4 style="border-color: ${toolColor};"><span>${escapeHtml(review.tool)}</span>${noveltyBadge}</h4>
                    <blockquote>${commentText}</blockquote>
                    ${diffHTML ? `<div class="diff-container">${diffHTML}</div>` : ''}
                </div>`;
        });
        card.innerHTML = `
            <div class="finding-card-header">
                <h3><code>${escapeHtml(finding.location)}</code></h3>
                <span class="category ${escapeHtml(finding.category.toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(finding.category)}</span>
            </div>
            <div class="finding-card-body">${reviewsHTML}</div>`;
        return card;
    }

    function createUnifiedCard(finding) {
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
            const toolColor = toolColorMap.get(review.tool) || '#8B949E';
            review.suggested_code.split('\n').forEach((line, i) => {
                const toolName = i === 0 ? `<span style="color:${toolColor};">${escapeHtml(review.tool)}</span>` : '';
                unifiedDiffHTML += `<tr class="line-sugg"><td class="line-num">+</td><td class="tool-name-cell">${toolName}</td><td class="line-code">${escapeHtml(line)}</td></tr>`;
            });
        });
        unifiedDiffHTML += `</tbody></table></div>`;

        let otherCommentsHTML = '';
        if (reviewsWithoutSuggestions.length > 0) {
            otherCommentsHTML = '<div class="other-comments-container"><h5>Additional Comments</h5>';
            reviewsWithoutSuggestions.forEach(review => {
                const toolColor = toolColorMap.get(review.tool) || '#8B949E';
                const noveltyBadge = review.is_novel ? '<span class="novelty-badge">✨ Novel</span>' : '';
                otherCommentsHTML += `
                    <div class="tool-review-small" style="border-color: ${toolColor};">
                        <h4><span>${escapeHtml(review.tool)}</span>${noveltyBadge}</h4>
                        <blockquote>${escapeHtml(review.comment)}</blockquote>
                    </div>`;
            });
            otherCommentsHTML += '</div>';
        }

        card.innerHTML = `
            <div class="finding-card-header">
                <h3><code>${escapeHtml(finding.location)}</code></h3>
                <span class="category ${escapeHtml(finding.category.toLowerCase().replace(/ /g, '-'))}">${escapeHtml(finding.category)}</span>
            </div>
            <div class="finding-card-body unified">${unifiedDiffHTML}${otherCommentsHTML}</div>`;
        return card;
    }

    function escapeHtml(unsafe) {
        return unsafe ? unsafe.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : '';
    }

    // =================================================================
    // 5. CHART RENDERING
    // =================================================================

    function renderCharts(results, filters) {
        destroyAllCharts();
        assignToolColors(results.metadata.tool_names);
        renderFindingsByToolChart(results, filters);
        renderFindingsByCategoryChart(results, filters);
        renderToolStrengthChart(results, filters);
        renderFindingsByFileChart(results, filters);
        renderNoveltyScoreChart(results, filters);
        renderFindingsDensityChart(results, filters);
        renderReviewSpeedChart(results, filters);
        renderCommentVerbosityChart(results, filters);
        renderSuggestionOverlapChart(results, filters);
        renderHistoryCharts();
    }

    function destroyAllCharts() {
        Object.values(activeCharts).forEach(chart => chart?.destroy());
        activeCharts = {};
    }

    function assignToolColors(toolNames) {
        const DISTINCT_COLORS = ['#58A6FF', '#F778BA', '#3FB950', '#A371F7', '#F0B939', '#48D9A4'];
        toolColorMap.clear();
        toolNames.forEach((toolName, index) => toolColorMap.set(toolName, DISTINCT_COLORS[index % DISTINCT_COLORS.length]));
    }

    function showSkeletons(show) {
        document.querySelectorAll('.chart-wrapper').forEach(wrapper => {
            const canvas = wrapper.querySelector('canvas');
            let skeleton = wrapper.querySelector('.skeleton');
            if (show) {
                if (canvas) canvas.style.display = 'none';
                if (!skeleton) {
                    skeleton = document.createElement('div');
                    skeleton.className = 'skeleton';
                    wrapper.appendChild(skeleton);
                }
            } else {
                if (canvas) canvas.style.display = 'block';
                skeleton?.remove();
            }
        });
    }

    function filterDataByTool(dataArray, allLabels, activeLabelsSet) {
        const filtered = {labels: [], data: []};
        allLabels.forEach((label, i) => {
            if (activeLabelsSet.has(label)) {
                filtered.labels.push(label);
                filtered.data.push(dataArray[i]);
            }
        });
        return filtered;
    }

    // --- Individual Chart Functions (with safety checks) ---

    function renderFindingsByToolChart(results, filters) {
        const ctx = document.getElementById('findingsByToolChart')?.getContext('2d');
        const chartData = results.summary_charts.findings_by_tool;
        if (!ctx || !chartData) return;

        const filteredData = filterDataByTool(chartData, results.metadata.tool_names, filters.tools);
        activeCharts.findingsByTool = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool))
                }]
            },
            options: {
                indexAxis: 'y',
                plugins: {legend: {display: false}, title: {display: true, text: 'Findings by Tool'}}
            }
        });
    }

    function renderFindingsByCategoryChart(results, filters) {
        const ctx = document.getElementById('findingsByCategoryChart')?.getContext('2d');
        const chartData = results.summary_charts.findings_by_category;
        if (!ctx || !chartData?.labels?.length) return;

        activeCharts.findingsByCategory = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: chartData.labels,
                datasets: [{
                    data: chartData.data,
                    backgroundColor: ['#DA3633', '#238636', '#D73A49', '#1F6FEB', '#F0B939']
                }]
            },
            options: {
                plugins: {
                    title: {display: true, text: 'Findings by Category (Click to Filter)'},
                    legend: {position: 'right'}
                },
                onClick: (_, elements) => {
                    if (elements.length > 0) {
                        const category = activeCharts.findingsByCategory.data.labels[elements[0].index];
                        activeFilters.category = activeFilters.category === category ? null : category;
                        renderToolStrengthChart(currentAnalysisResults, activeFilters);
                    }
                }
            }
        });
    }

    function renderToolStrengthChart(results, filters) {
        const ctx = document.getElementById('toolStrengthChart')?.getContext('2d');
        const chartData = results.summary_charts.tool_strength_profile;
        if (!ctx || !chartData) return;

        const {tool_names, categories, data} = chartData;
        const toolIndices = tool_names.map((tool, i) => filters.tools.has(tool) ? i : -1).filter(i => i !== -1);
        const filteredLabels = toolIndices.map(i => tool_names[i]);
        const filteredData = toolIndices.map(i => data[i]);

        const chartConfig = {
            type: 'bar',
            options: {
                scales: {x: {stacked: true}, y: {stacked: true}},
                plugins: {
                    legend: {display: true},
                    title: {
                        display: true,
                        text: `Tool Strength Profile ${filters.category ? `(${filters.category})` : ''}`
                    }
                }
            }
        };

        if (filters.category) {
            const categoryIndex = categories.indexOf(filters.category);
            chartConfig.data = {
                labels: filteredLabels,
                datasets: (categoryIndex > -1) ? [{
                    label: filters.category,
                    data: filteredData.map(d => d[categoryIndex]),
                    backgroundColor: ['#DA3633', '#238636', '#D73A49', '#1F6FEB', '#F0B939'][categoryIndex % 5],
                }] : []
            };
        } else {
            chartConfig.data = {
                labels: filteredLabels,
                datasets: categories.map((cat, i) => ({
                    label: cat,
                    data: filteredData.map(d => d[i]),
                    backgroundColor: ['#DA3633', '#238636', '#D73A49', '#1F6FEB', '#F0B939'][i % 5],
                }))
            };
        }

        if (activeCharts.toolStrength) {
            activeCharts.toolStrength.data = chartConfig.data;
            activeCharts.toolStrength.options.plugins.title.text = chartConfig.options.plugins.title.text;
            activeCharts.toolStrength.update();
        } else {
            activeCharts.toolStrength = new Chart(ctx, chartConfig);
        }
    }

    function renderFindingsByFileChart(results, filters) {
        const ctx = document.getElementById('findingsByFileChart')?.getContext('2d');
        const chartData = results.summary_charts.findings_by_file;
        if (!ctx || !chartData?.labels?.length) return;
        activeCharts.findingsByFile = new Chart(ctx, {
            type: 'bar',
            data: {labels: chartData.labels, datasets: [{data: chartData.data, backgroundColor: '#A371F7'}]},
            options: {
                indexAxis: 'y',
                plugins: {legend: {display: false}, title: {display: true, text: 'Findings per File'}}
            }
        });
    }

    function renderNoveltyScoreChart(results, filters) {
        const ctx = document.getElementById('noveltyScoreChart')?.getContext('2d');
        const chartData = results.summary_charts.novelty_score;
        if (!ctx || !chartData) return;
        const filteredData = filterDataByTool(chartData, results.metadata.tool_names, filters.tools);
        activeCharts.noveltyScore = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool))
                }]
            },
            options: {plugins: {legend: {display: false}, title: {display: true, text: 'Novelty Score (%)'}}}
        });
    }

    function renderFindingsDensityChart(results, filters) {
        const ctx = document.getElementById('findingsDensityChart')?.getContext('2d');
        const chartData = results.summary_charts.findings_density;
        if (!ctx || !chartData) return;
        const filteredData = filterDataByTool(chartData, results.metadata.tool_names, filters.tools);
        activeCharts.findingsDensity = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool))
                }]
            },
            options: {plugins: {legend: {display: false}, title: {display: true, text: 'Findings per 100 LoC'}}}
        });
    }

    function renderReviewSpeedChart(results, filters) {
        const ctx = document.getElementById('reviewSpeedChart')?.getContext('2d');
        const chartData = results.summary_charts.review_speed;
        if (!ctx || !chartData?.labels?.length) return;
        const filteredData = filterDataByTool(chartData.data, chartData.labels, filters.tools);
        activeCharts.reviewSpeed = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool))
                }]
            },
            options: {plugins: {legend: {display: false}, title: {display: true, text: 'Review Speed (Avg. Seconds)'}}}
        });
    }

    function renderCommentVerbosityChart(results, filters) {
        const ctx = document.getElementById('commentVerbosityChart')?.getContext('2d');
        const chartData = results.summary_charts.comment_verbosity;
        if (!ctx || !chartData?.labels?.length) return;
        const filteredData = filterDataByTool(chartData.data, chartData.labels, filters.tools);
        activeCharts.commentVerbosity = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool))
                }]
            },
            options: {
                plugins: {
                    legend: {display: false},
                    title: {display: true, text: 'Comment Verbosity (Avg. Chars)'}
                }
            }
        });
    }

    function renderSuggestionOverlapChart(results, filters) {
        const ctx = document.getElementById('suggestionOverlapChart')?.getContext('2d');
        if (!ctx) return;
        const overlaps = (results.summary_charts.suggestion_overlap || [])
            .filter(item => item.sets.length > 1 && item.sets.every(tool => filters.tools.has(tool)))
            .sort((a, b) => b.size - a.size).slice(0, 10);
        if (overlaps.length === 0) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            const wrapper = ctx.canvas.parentElement;
            if (wrapper) {
                const noDataMessage = document.createElement('p');
                noDataMessage.className = 'no-data-message';
                noDataMessage.textContent = 'No overlaps for selected tools.';
                if (wrapper.querySelector('.no-data-message')) wrapper.querySelector('.no-data-message').remove();
                wrapper.appendChild(noDataMessage);
            }
            return;
        }
        const wrapper = ctx.canvas.parentElement;
        if (wrapper && wrapper.querySelector('.no-data-message')) wrapper.querySelector('.no-data-message').remove();

        activeCharts.suggestionOverlap = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: overlaps.map(d => d.sets.join(' & ')),
                datasets: [{data: overlaps.map(d => d.size), backgroundColor: '#F87171'}]
            },
            options: {
                indexAxis: 'y',
                plugins: {legend: {display: false}, title: {display: true, text: 'Suggestion Overlaps'}}
            }
        });
    }

    async function renderHistoryCharts() {
        const findingsCtx = document.getElementById('historyFindingsChart')?.getContext('2d');
        const noveltyCtx = document.getElementById('historyNoveltyChart')?.getContext('2d');
        if (!findingsCtx || !noveltyCtx) return;
        try {
            const response = await fetch('/api/get-history');
            if (!response.ok) return;
            const historyData = await response.json();
            if (historyData.length === 0) return;
            const tools = [...new Set(historyData.map(d => d.tool_name))];
            assignToolColors(tools);
            const labels = [...new Set(historyData.map(d => new Date(d.timestamp).toLocaleDateString('en-CA')))].sort((a, b) => new Date(a) - new Date(b));
            const createDataset = (metric) => tools.map(tool => ({
                label: tool,
                data: labels.map(label => {
                    const entry = historyData.find(d => new Date(d.timestamp).toLocaleDateString('en-CA') === label && d.tool_name === tool);
                    return entry ? entry[metric] : null;
                }),
                borderColor: toolColorMap.get(tool),
                backgroundColor: toolColorMap.get(tool),
                tension: 0.2,
                spanGaps: true
            }));
            if (activeCharts.historyFindings) activeCharts.historyFindings.destroy();
            activeCharts.historyFindings = new Chart(findingsCtx, {
                type: 'line',
                data: {labels, datasets: createDataset('finding_count')},
                options: {plugins: {title: {display: true, text: 'Findings Over Time'}, legend: {display: true}}}
            });
            if (activeCharts.historyNovelty) activeCharts.historyNovelty.destroy();
            activeCharts.historyNovelty = new Chart(noveltyCtx, {
                type: 'line',
                data: {labels, datasets: createDataset('novelty_score')},
                options: {
                    plugins: {
                        title: {display: true, text: 'Novelty Score Over Time (%)'},
                        legend: {display: true}
                    }
                }
            });
        } catch (error) {
            console.error("Could not render history charts:", error);
        }
    }

    // =================================================================
    // 6. INITIALIZATION
    // =================================================================

    function init() {
        // Set global Chart.js defaults
        Chart.defaults.color = 'var(--color-text-primary)';
        Chart.defaults.borderColor = 'var(--color-border)';
        Chart.defaults.plugins.legend.position = 'bottom';
        Chart.defaults.plugins.legend.labels.boxWidth = 12;
        Chart.defaults.plugins.legend.labels.padding = 20;
        Chart.defaults.responsive = true;
        Chart.defaults.maintainAspectRatio = false;

        // Attach main event listeners
        fetchButton.addEventListener('click', fetchAnalysis);
        exportButton.addEventListener('click', exportData);
        navLinks.forEach(link => link.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(link.getAttribute('data-view'));
        }));
        tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.getAttribute('data-tab'))));
        viewSideBySideBtn.addEventListener('click', () => {
            currentFindingsViewMode = 'side-by-side';
            if (currentAnalysisResults) renderFindings(currentAnalysisResults, activeFilters);
        });
        viewUnifiedBtn.addEventListener('click', () => {
            currentFindingsViewMode = 'unified';
            if (currentAnalysisResults) renderFindings(currentAnalysisResults, activeFilters);
        });

        getPullRequests();
        switchView('initial');
    }
    init();

});