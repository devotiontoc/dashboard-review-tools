document.addEventListener('DOMContentLoaded', () => {
    // =================================================================
    // 1. APPLICATION STATE & CONFIGURATION
    // =================================================================
    let currentAnalysisResults = null;
    let activeCharts = {};
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
            if (!currentAnalysisResults?.metadata || !currentAnalysisResults?.summary_charts || !currentAnalysisResults?.findings) {
                throw new Error("Received incomplete or malformed analysis data from the API.");
            }

            fetch('/api/save-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentAnalysisResults)
            }).catch(err => console.error("History Save Failed:", err)); // Log error but don't stop UI

            activeFilters.tools = new Set(currentAnalysisResults.metadata.tool_names);
            activeFilters.category = null;
            renderUI();
        } catch (error) {
            console.error("CRITICAL ERROR in fetchAnalysis:", error);
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
        try {
            switchView('dashboard');
            switchTab('overview');
            dashboardControls.style.display = 'flex';
            assignToolColors(currentAnalysisResults.metadata.tool_names);
            renderFilters(currentAnalysisResults.metadata.tool_names, activeFilters.tools);
            updateKPIs(currentAnalysisResults, activeFilters);
            renderFindings(currentAnalysisResults, activeFilters);
            renderCharts(currentAnalysisResults, activeFilters);
        } catch (error) {
            console.error("Error during main UI render:", error);
            showError("A critical error occurred while displaying the dashboard.");
        }
    }

    function setFindingsViewMode(mode) {
        currentFindingsViewMode = mode;
        viewSideBySideBtn.classList.toggle('active', mode === 'side-by-side');
        viewUnifiedBtn.classList.toggle('active', mode === 'unified');
        if (currentAnalysisResults) {
            renderFindings(currentAnalysisResults, activeFilters);
        }
    }

    function toggleLoading(isLoading) {
        if(loader) loader.style.display = isLoading ? 'block' : 'none';
        if(fetchButton) fetchButton.disabled = isLoading;
        if (isLoading) showError('');
    }

    function showError(message) {
        if(errorDisplay) {
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
                activeFilters.tools = new Set(Array.from(toolFilterContainer.querySelectorAll('input:checked')).map(cb => cb.dataset.tool));
                renderUI();
            });
        });
    }

    function updateKPIs(results, filters) {
        try {
            if (!results.findings) return;
            const filteredFindings = results.findings.flatMap(f => f.reviews).filter(r => filters.tools.has(r.tool));
            const totalFindings = filteredFindings.length;
            const novelScores = filteredFindings.filter(r => r.is_novel).length;
            const avgNovelty = totalFindings > 0 ? (novelScores / totalFindings) * 100 : 0;
            if(kpiTotalFindings) kpiTotalFindings.textContent = totalFindings;
            if(kpiLinesAnalyzed) kpiLinesAnalyzed.textContent = results.metadata.lines_changed;
            if(kpiAvgNovelty) kpiAvgNovelty.textContent = `${avgNovelty.toFixed(0)}%`;
        } catch (error) {
            console.error("Failed to update KPIs:", error);
        }
    }

    function renderFindings(results, filters) {
        if (!findingsContainer) return;

        try {
            findingsContainer.innerHTML = '';

            // First, get the findings that match the active tool filters
            const filteredFindings = results.findings
                .map(finding => ({ ...finding, reviews: finding.reviews.filter(review => filters.tools.has(review.tool)) }))
                .filter(finding => finding.reviews.length > 0);

            if (filteredFindings.length === 0) {
                findingsContainer.innerHTML = '<p class="no-data-message">No findings match the current filters.</p>';
                return;
            }

            // Now, group those findings by their file path
            const groupedByFile = filteredFindings.reduce((acc, finding) => {
                // Use the file path as a key, or "General" for non-file specific findings
                const key = finding.location.includes(':') ? finding.location.split(':')[0] : 'General';
                if (!acc[key]) {
                    acc[key] = [];
                }
                acc[key].push(finding);
                return acc;
            }, {});

            // Finally, render each group of findings
            Object.entries(groupedByFile).forEach(([filePath, findingsInFile]) => {
                // Create the main container for the file group
                const groupEl = document.createElement('div');
                groupEl.className = 'file-group';

                // Create the clickable header
                const headerEl = document.createElement('div');
                headerEl.className = 'file-group-header';
                headerEl.innerHTML = `
                <h3><code>${escapeHtml(filePath)}</code></h3>
                <div class="file-meta">
                    <span>${findingsInFile.length} finding(s)</span>
                    <i class="fas fa-chevron-right toggle-icon"></i>
                </div>
            `;

                // Create the body that will contain the finding cards
                const bodyEl = document.createElement('div');
                bodyEl.className = 'file-group-body';

                // Add the event listener to make it collapsible
                headerEl.addEventListener('click', () => {
                    headerEl.classList.toggle('is-expanded');
                    bodyEl.classList.toggle('is-expanded');
                });

                // Create and add each finding card to this group's body
                findingsInFile.forEach(finding => {
                    const hasSuggestion = finding.reviews.some(r => r.suggested_code);
                    const card = (currentFindingsViewMode === 'unified' && hasSuggestion) ? createUnifiedCard(finding) : createSideBySideCard(finding);
                    bodyEl.appendChild(card);
                });

                // Append the header and body to the group container
                groupEl.appendChild(headerEl);
                groupEl.appendChild(bodyEl);

                // Add the completed group to the main findings container
                findingsContainer.appendChild(groupEl);
            });

        } catch (error) {
            console.error("Failed to render findings:", error);
            findingsContainer.innerHTML = '<p class="no-data-message error-message">Could not display findings due to an error.</p>';
        }
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
                diffHTML = Diff2Html.html(diffString, { drawFileList: false, matching: 'lines', outputFormat: 'side-by-side' });
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

        if (originalCode) {
            originalCode.split('\n').forEach(line => {
                unifiedDiffHTML += `<tr class="line-orig"><td class="line-num">-</td><td class="tool-name-cell"></td><td class="line-code">${escapeHtml(line)}</td></tr>`;
            });
        }

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
                <span class="category ${escapeHtml(finding.category.toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(finding.category)}</span>
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
        //assignToolColors(results.metadata.tool_names);

        tryAndLog(renderFindingsByToolChart, 'FindingsByToolChart', results, filters);
        tryAndLog(renderFindingsByCategoryChart, 'FindingsByCategoryChart', results, filters);
        tryAndLog(renderToolStrengthChart, 'ToolStrengthChart', results, filters);
        tryAndLog(renderFindingsByFileChart, 'FindingsByFileChart', results, filters);
        tryAndLog(renderNoveltyScoreChart, 'NoveltyScoreChart', results, filters);
        tryAndLog(renderFindingsDensityChart, 'FindingsDensityChart', results, filters);
        tryAndLog(renderReviewSpeedChart, 'ReviewSpeedChart', results, filters);
        tryAndLog(renderCommentVerbosityChart, 'CommentVerbosityChart', results, filters);
        tryAndLog(renderSuggestionOverlapChart, 'SuggestionOverlapChart', results, filters);
        tryAndLog(renderHistoryCharts, 'HistoryCharts');
    }

    function tryAndLog(fn, chartName, ...args) {
        try {
            fn(...args);
        } catch (error) {
            console.error(`Failed to render chart: ${chartName}`, error);
        }
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

    // A robust function to prepare a chart's canvas for re-rendering
    function prepareCanvas(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const wrapper = canvas.parentElement;
        if (!wrapper) return null;
        wrapper.innerHTML = `<canvas id="${canvasId}"></canvas>`;
        return document.getElementById(canvasId);
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
        const filtered = { labels: [], data: [] };
        allLabels.forEach((label, i) => {
            if (activeLabelsSet.has(label)) {
                filtered.labels.push(label);
                if (dataArray && dataArray[i] !== undefined) {
                    filtered.data.push(dataArray[i]);
                }
            }
        });
        return filtered;
    }

    // --- Individual Chart Functions (with robust re-rendering) ---

    function renderFindingsByToolChart(results, filters) {
        const canvas = prepareCanvas('findingsByToolChart');
        if (!canvas) return;
        const chartData = results.summary_charts.findings_by_tool;
        const filteredData = filterDataByTool(chartData, results.metadata.tool_names, filters.tools);
        activeCharts.findingsByTool = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: filteredData.labels, datasets: [{ data: filteredData.data, backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool)) }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Findings by Tool' } } }
        });
    }

    function renderFindingsByCategoryChart(results, filters) {
        const canvas = prepareCanvas('findingsByCategoryChart');
        if (!canvas) return;

        const categoryCounts = results.findings.reduce((acc, finding) => {
            const hasVisibleReview = finding.reviews.some(review => filters.tools.has(review.tool));
            if (hasVisibleReview) {
                const count = finding.reviews.filter(r => filters.tools.has(r.tool)).length;
                acc[finding.category] = (acc[finding.category] || 0) + count;
            }
            return acc;
        }, {});

        const labels = Object.keys(categoryCounts);
        const data = Object.values(categoryCounts);

        if (labels.length === 0) {
            canvas.parentElement.innerHTML = '<p class="no-data-message">No findings for selected tools.</p>';
            return;
        }

        activeCharts.findingsByCategory = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels: labels, datasets: [{ data: data, backgroundColor: ['#DA3633', '#238636', '#D73A49', '#1F6FEB', '#F0B939', '#A371F7'] }] },
            options: {
                plugins: { title: { display: true, text: 'Findings by Category (Click to Filter)' }, legend: { position: 'right' } },
                onClick: (_, elements) => {
                    if (elements.length > 0 && activeCharts.findingsByCategory) {
                        const category = activeCharts.findingsByCategory.data.labels[elements[0].index];
                        activeFilters.category = activeFilters.category === category ? null : category;
                        tryAndLog(renderToolStrengthChart, 'ToolStrengthChartUpdate', currentAnalysisResults, activeFilters);
                    }
                }
            }
        });
    }

    function renderToolStrengthChart(results, filters) {
        const canvas = prepareCanvas('toolStrengthChart');
        if (!canvas) return;

        const chartData = results.summary_charts.tool_strength_profile;
        const { tool_names, categories, data } = chartData;

        const toolIndices = tool_names.map((tool, i) => filters.tools.has(tool) ? i : -1).filter(i => i !== -1);
        const filteredLabels = toolIndices.map(i => tool_names[i]);
        const filteredData = toolIndices.map(i => data[i]);

        const chartConfig = {
            type: 'bar',
            options: {
                scales: { x: { stacked: true }, y: { stacked: true } },
                plugins: { legend: { display: true }, title: { display: true, text: `Tool Strength Profile ${filters.category ? `(${filters.category})` : ''}` } }
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

        activeCharts.toolStrength = new Chart(canvas.getContext('2d'), chartConfig);
    }

    function renderFindingsByFileChart(results, filters) {
        const canvas = prepareCanvas('findingsByFileChart');
        if (!canvas) return;

        const findingsPerFile = results.findings.reduce((acc, finding) => {
            const hasVisibleReview = finding.reviews.some(review => filters.tools.has(review.tool));
            if (hasVisibleReview && finding.location !== "General PR Summary") {
                const file = finding.location.split(':')[0];
                acc[file] = (acc[file] || 0) + 1;
            }
            return acc;
        }, {});

        const labels = Object.keys(findingsPerFile);
        const data = Object.values(findingsPerFile);

        if (labels.length === 0) {
            canvas.parentElement.innerHTML = '<p class="no-data-message">No findings for selected tools.</p>';
            return;
        }

        activeCharts.findingsByFile = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets: [{ data, backgroundColor: '#A371F7' }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Findings per File' } } }
        });
    }

    function renderNoveltyScoreChart(results, filters) {
        const canvas = prepareCanvas('noveltyScoreChart');
        if (!canvas) return;
        const chartData = results.summary_charts.novelty_score;
        const filteredData = filterDataByTool(chartData, results.metadata.tool_names, filters.tools);
        activeCharts.noveltyScore = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: filteredData.labels, datasets: [{ data: filteredData.data, backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool)) }] },
            options: { plugins: { legend: { display: false }, title: { display: true, text: 'Novelty Score (%)' } } }
        });
    }

    function renderFindingsDensityChart(results, filters) {
        const canvas = prepareCanvas('findingsDensityChart');
        if (!canvas) return;
        const chartData = results.summary_charts.findings_density;
        const filteredData = filterDataByTool(chartData, results.metadata.tool_names, filters.tools);
        activeCharts.findingsDensity = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: filteredData.labels, datasets: [{ data: filteredData.data, backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool)) }] },
            options: { plugins: { legend: { display: false }, title: { display: true, text: 'Findings per 100 LoC' } } }
        });
    }

    function renderReviewSpeedChart(results, filters) {
        const canvas = prepareCanvas('reviewSpeedChart');
        if (!canvas) return;
        const chartData = results.summary_charts.review_speed;
        const filteredData = filterDataByTool(chartData.data, chartData.labels, filters.tools);
        activeCharts.reviewSpeed = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: filteredData.labels, datasets: [{ data: filteredData.data, backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool)) }] },
            options: { plugins: { legend: { display: false }, title: { display: true, text: 'Review Speed (Avg. Seconds)' } } }
        });
    }

    function renderCommentVerbosityChart(results, filters) {
        const canvas = prepareCanvas('commentVerbosityChart');
        if (!canvas) return;
        const chartData = results.summary_charts.comment_verbosity;
        const filteredData = filterDataByTool(chartData.data, chartData.labels, filters.tools);
        activeCharts.commentVerbosity = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: filteredData.labels, datasets: [{ data: filteredData.data, backgroundColor: filteredData.labels.map(tool => toolColorMap.get(tool)) }] },
            options: { plugins: { legend: { display: false }, title: { display: true, text: 'Comment Verbosity (Avg. Chars)' } } }
        });
    }

    function renderSuggestionOverlapChart(results, filters) {
        const canvas = prepareCanvas('suggestionOverlapChart');
        if (!canvas) return;
        const overlaps = (results.summary_charts.suggestion_overlap || [])
            .filter(item => item.sets.length > 1 && item.sets.every(tool => filters.tools.has(tool)))
            .sort((a, b) => b.size - a.size).slice(0, 10);

        if (overlaps.length === 0) {
            canvas.parentElement.innerHTML = '<p class="no-data-message">No overlaps for selected tools.</p>';
            return;
        }

        activeCharts.suggestionOverlap = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: overlaps.map(d => d.sets.join(' & ')), datasets: [{ data: overlaps.map(d => d.size), backgroundColor: '#F87171' }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Suggestion Overlaps' } } }
        });
    }

    async function renderHistoryCharts() {
        const findingsCanvas = prepareCanvas('historyFindingsChart');
        const noveltyCanvas = prepareCanvas('historyNoveltyChart');
        if (!findingsCanvas || !noveltyCanvas) return;

        try {
            const response = await fetch('/api/get-history');
            if (!response.ok) throw new Error('Failed to fetch history');
            const historyData = await response.json();

            if (!historyData || historyData.length === 0) {
                const msg = '<p class="no-data-message">No historical data available.</p>';
                if (findingsCanvas.parentElement) findingsCanvas.parentElement.innerHTML = msg;
                if (noveltyCanvas.parentElement) noveltyCanvas.parentElement.innerHTML = msg;
                return;
            }

            // Get all unique tools from the entire history to ensure all are plotted
            const tools = [...new Set(historyData.map(d => d.tool_name))];
            // Re-assign colors based on ALL historical tools to override any dashboard filters
            assignToolColors(tools);

            // Get unique PR numbers and sort them for the X-axis
            const prNumbers = [...new Set(historyData.map(d => d.pr_number))].sort((a, b) => a - b);
            const labels = prNumbers.map(pr => `#${pr}`);

            const createDataset = (metric) => tools.map(tool => {
                const data = prNumbers.map(prNum => {
                    const entry = historyData.find(d => d.pr_number === prNum && d.tool_name === tool);
                    return entry ? entry[metric] : null;
                });
                return {
                    label: tool,
                    data: data,
                    borderColor: toolColorMap.get(tool),
                    backgroundColor: toolColorMap.get(tool),
                    tension: 0.2,
                    spanGaps: true // Connects lines across gaps for a cleaner look
                };
            });

            const chartOptions = (titleText, yAxisText) => ({
                plugins: {
                    title: { display: true, text: titleText },
                    legend: { display: true, position: 'bottom' }
                },
                scales: {
                    x: { title: { display: true, text: 'Pull Request' } },
                    y: { title: { display: true, text: yAxisText }, beginAtZero: true }
                }
            });

            activeCharts.historyFindings = new Chart(findingsCanvas.getContext('2d'), {
                type: 'line',
                data: { labels, datasets: createDataset('finding_count') },
                options: chartOptions('Findings Over Time by PR', 'Total Findings')
            });
            activeCharts.historyNovelty = new Chart(noveltyCanvas.getContext('2d'), {
                type: 'line',
                data: { labels, datasets: createDataset('novelty_score') },
                options: chartOptions('Novelty Score Over Time by PR (%)', 'Novelty Score (%)')
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
        Chart.defaults.responsive = true;
        Chart.defaults.maintainAspectRatio = false;

        // Use theme colors for consistency
        const primaryTextColor = '#C9D1D9';
        const secondaryTextColor = '#C9D1D9';
        const gridAndBorderColor = '#C9D1D9';

        // Global text color (applies to tooltips, etc.)
        Chart.defaults.color = primaryTextColor;

        // Defaults for Plugins (Main Title at top & Legend at bottom)
        Chart.defaults.plugins.legend.position = 'bottom';
        Chart.defaults.plugins.legend.labels.color = primaryTextColor;
        Chart.defaults.plugins.legend.labels.boxWidth = 12;
        Chart.defaults.plugins.legend.labels.padding = 20;
        Chart.defaults.plugins.title.color = primaryTextColor;

        Chart.defaults.scales = Chart.defaults.scales || {};

        // -- Category Scale --
        Chart.defaults.scales.category = Chart.defaults.scales.category || {};
        Chart.defaults.scales.category.ticks = Chart.defaults.scales.category.ticks || {};
        Chart.defaults.scales.category.title = Chart.defaults.scales.category.title || {};
        Chart.defaults.scales.category.grid = Chart.defaults.scales.category.grid || {};

        Chart.defaults.scales.category.ticks.color = secondaryTextColor;
        Chart.defaults.scales.category.title.color = primaryTextColor;
        Chart.defaults.scales.category.grid.color = gridAndBorderColor;

        // -- Linear Scale --
        Chart.defaults.scales.linear = Chart.defaults.scales.linear || {};
        Chart.defaults.scales.linear.ticks = Chart.defaults.scales.linear.ticks || {};
        Chart.defaults.scales.linear.title = Chart.defaults.scales.linear.title || {};
        Chart.defaults.scales.linear.grid = Chart.defaults.scales.linear.grid || {};

        Chart.defaults.scales.linear.ticks.color = secondaryTextColor;
        Chart.defaults.scales.linear.title.color = primaryTextColor;
        Chart.defaults.scales.linear.grid.color = gridAndBorderColor;


        // Attach main event listeners
        fetchButton.addEventListener('click', fetchAnalysis);
        exportButton.addEventListener('click', exportData);
        navLinks.forEach(link => link.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(link.getAttribute('data-view'));
        }));
        tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.getAttribute('data-tab'))));

        // Event listeners for the view-mode toggle buttons
        viewSideBySideBtn.addEventListener('click', () => setFindingsViewMode('side-by-side'));
        viewUnifiedBtn.addEventListener('click', () => setFindingsViewMode('unified'));

        getPullRequests();
        switchView('initial');
    }

    init();
});