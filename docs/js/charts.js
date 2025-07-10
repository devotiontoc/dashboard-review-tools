/**
 * Manages all Chart.js instances, rendering, and interactions.
 */
export const ChartManager = {
    activeCharts: {},
    toolColorMap: new Map(),
    categoryClickHandler: null,

    /**
     * Sets global Chart.js defaults to ensure consistent styling.
     * This is the definitive fix for the legend color issue.
     */
    init() {
        Chart.defaults.color = 'var(--color-text-primary)';
        Chart.defaults.borderColor = 'var(--color-border)';
        Chart.defaults.plugins.legend.position = 'bottom';
        Chart.defaults.plugins.legend.labels.boxWidth = 12;
        Chart.defaults.plugins.legend.labels.padding = 20;
        Chart.defaults.responsive = true;
        Chart.defaults.maintainAspectRatio = false;
    },

    setCategoryClickHandler(handler) {
        this.categoryClickHandler = handler;
    },

    getToolColorMap() {
        return this.toolColorMap;
    },

    /**
     * Renders all charts based on the provided data and filters.
     * @param {object} results - The full analysis data.
     * @param {object} filters - The current active filters.
     */
    renderAll(results, filters) {
        this._destroyAll();
        this._assignToolColors(results.metadata.tool_names);

        // Render charts for each tab
        this.renderOverviewCharts(results, filters);
        this.renderPerformanceCharts(results, filters);
        this.renderOverlapCharts(results, filters);
        this.renderHistoryCharts(results); // History doesn't use filters
    },

    /**
     * Shows or hides skeleton loaders in place of charts.
     * @param {boolean} show - True to show skeletons, false to hide.
     */
    showSkeletons(show) {
        const wrappers = document.querySelectorAll('.chart-wrapper');
        wrappers.forEach(wrapper => {
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
                if (skeleton) {
                    skeleton.remove();
                }
            }
        });
    },

    // =================================================================
    // CHART GROUP RENDERERS
    // =================================================================

    renderOverviewCharts(results, filters) {
        this.renderFindingsByToolChart(results, filters);
        this.renderFindingsByCategoryChart(results, filters);
        this.updateToolStrengthChart(results, filters);
        this.renderFindingsByFileChart(results, filters);
    },

    renderPerformanceCharts(results, filters) {
        this.renderNoveltyScoreChart(results, filters);
        this.renderFindingsDensityChart(results, filters);
        this.renderReviewSpeedChart(results, filters);
        this.renderCommentVerbosityChart(results, filters);
    },

    renderOverlapCharts(results, filters) {
        this.renderSuggestionOverlapChart(results, filters);
    },

    renderHistoryCharts(results) {
        // This can be expanded to fetch its own data if needed.
        // For now, we assume history data is loaded separately or not yet implemented.
    },

    // =================================================================
    // INDIVIDUAL CHART RENDERING METHODS
    // =================================================================

    renderFindingsByToolChart(results, filters) {
        const ctx = document.getElementById('findingsByToolChart').getContext('2d');
        const filteredData = this._filterDataByTool(results.summary_charts.findings_by_tool, results.metadata.tool_names, filters.tools);

        this.activeCharts.findingsByTool = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    label: 'Total Findings',
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => this.toolColorMap.get(tool)),
                }]
            },
            options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Findings by Tool' } } }
        });
    },

    renderFindingsByCategoryChart(results, filters) {
        const ctx = document.getElementById('findingsByCategoryChart').getContext('2d');
        const { labels, data } = results.summary_charts.findings_by_category;

        this.activeCharts.findingsByCategory = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ['#DA3633', '#238636', '#D73A49', '#1F6FEB', '#F0B939'],
                    borderColor: 'var(--color-bg-med)',
                    borderWidth: 2,
                }]
            },
            options: {
                plugins: {
                    title: { display: true, text: 'Findings by Category (Click to Filter)' },
                    legend: { position: 'right' }
                },
                onClick: (evt, elements) => {
                    if (elements.length > 0 && this.categoryClickHandler) {
                        const clickedIndex = elements[0].index;
                        const category = this.activeCharts.findingsByCategory.data.labels[clickedIndex];
                        this.categoryClickHandler(category);
                    }
                }
            }
        });
    },

    updateToolStrengthChart(results, filters) {
        const { tool_names, categories } = results.summary_charts.tool_strength_profile;
        let data = results.summary_charts.tool_strength_profile.data;

        let filteredLabels = tool_names;
        let filteredData = data;

        // Apply tool filter first
        const toolIndices = tool_names.map((tool, i) => filters.tools.has(tool) ? i : -1).filter(i => i !== -1);
        filteredLabels = toolIndices.map(i => tool_names[i]);
        filteredData = toolIndices.map(i => data[i]);

        let chartDataSets;
        // Then apply category filter if one is active
        if (filters.category) {
            const categoryIndex = categories.indexOf(filters.category);
            if (categoryIndex !== -1) {
                chartDataSets = [{
                    label: filters.category,
                    data: filteredData.map(toolData => toolData[categoryIndex]),
                    backgroundColor: ['#DA3633', '#238636', '#D73A49', '#1F6FEB', '#F0B939'][categoryIndex % 5],
                }];
            }
        } else {
            // Default: show all categories stacked
            chartDataSets = categories.map((cat, i) => ({
                label: cat,
                data: filteredData.map(toolData => toolData[i]),
                backgroundColor: ['#DA3633', '#238636', '#D73A49', '#1F6FEB', '#F0B939'][i % 5],
            }));
        }

        const chartConfig = {
            type: 'bar',
            data: {
                labels: filteredLabels,
                datasets: chartDataSets
            },
            options: {
                scales: { x: { stacked: true }, y: { stacked: true } },
                plugins: { legend: { display: true }, title: { display: true, text: `Tool Strength Profile ${filters.category ? `(${filters.category})` : ''}` } }
            }
        };

        if (this.activeCharts.toolStrength) {
            this.activeCharts.toolStrength.data = chartConfig.data;
            this.activeCharts.toolStrength.options.plugins.title.text = chartConfig.options.plugins.title.text;
            this.activeCharts.toolStrength.update();
        } else {
            const ctx = document.getElementById('toolStrengthChart').getContext('2d');
            this.activeCharts.toolStrength = new Chart(ctx, chartConfig);
        }
    },

    renderFindingsByFileChart(results, filters) {
        const ctx = document.getElementById('findingsByFileChart').getContext('2d');
        const { labels, data } = results.summary_charts.findings_by_file;

        this.activeCharts.findingsByFile = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Findings per File',
                    data: data,
                    backgroundColor: '#A371F7',
                }]
            },
            options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Findings per File' } } }
        });
    },

    renderNoveltyScoreChart(results, filters) {
        const ctx = document.getElementById('noveltyScoreChart').getContext('2d');
        const filteredData = this._filterDataByTool(results.summary_charts.novelty_score, results.metadata.tool_names, filters.tools);

        this.activeCharts.noveltyScore = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    label: 'Novelty Score (%)',
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => this.toolColorMap.get(tool)),
                }]
            },
            options: { plugins: { legend: { display: false }, title: { display: true, text: 'Novelty Score (%)' } } }
        });
    },

    renderFindingsDensityChart(results, filters) {
        const ctx = document.getElementById('findingsDensityChart').getContext('2d');
        const filteredData = this._filterDataByTool(results.summary_charts.findings_density, results.metadata.tool_names, filters.tools);

        this.activeCharts.findingsDensity = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    label: 'Findings per 100 LoC',
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => this.toolColorMap.get(tool)),
                }]
            },
            options: { plugins: { legend: { display: false }, title: { display: true, text: 'Findings per 100 LoC' } } }
        });
    },

    renderReviewSpeedChart(results, filters) {
        const ctx = document.getElementById('reviewSpeedChart').getContext('2d');
        const filteredData = this._filterDataByTool(results.summary_charts.review_speed.data, results.summary_charts.review_speed.labels, filters.tools);

        this.activeCharts.reviewSpeed = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    label: 'Avg. Seconds to Comment',
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => this.toolColorMap.get(tool)),
                }]
            },
            options: { plugins: { legend: { display: false }, title: { display: true, text: 'Review Speed (Avg. Seconds)' } } }
        });
    },

    renderCommentVerbosityChart(results, filters) {
        const ctx = document.getElementById('commentVerbosityChart').getContext('2d');
        const filteredData = this._filterDataByTool(results.summary_charts.comment_verbosity.data, results.summary_charts.comment_verbosity.labels, filters.tools);

        this.activeCharts.commentVerbosity = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: filteredData.labels,
                datasets: [{
                    label: 'Avg. Characters per Comment',
                    data: filteredData.data,
                    backgroundColor: filteredData.labels.map(tool => this.toolColorMap.get(tool)),
                }]
            },
            options: { plugins: { legend: { display: false }, title: { display: true, text: 'Comment Verbosity (Avg. Chars)' } } }
        });
    },

    renderSuggestionOverlapChart(results, filters) {
        const ctx = document.getElementById('suggestionOverlapChart').getContext('2d');
        const overlaps = (results.summary_charts.suggestion_overlap || [])
            .filter(item => item.sets.length > 1 && item.sets.every(tool => filters.tools.has(tool)))
            .sort((a, b) => b.size - a.size)
            .slice(0, 10);

        if (overlaps.length === 0) {
            // Handle case with no overlaps after filtering
            return;
        }

        this.activeCharts.suggestionOverlap = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: overlaps.map(d => d.sets.join(' & ')),
                datasets: [{
                    label: 'Overlapping Findings',
                    data: overlaps.map(d => d.size),
                    backgroundColor: '#F87171'
                }]
            },
            options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Suggestion Overlaps' } } }
        });
    },

    // =================================================================
    // HELPER METHODS
    // =================================================================

    _destroyAll() {
        Object.values(this.activeCharts).forEach(chart => {
            if (chart) chart.destroy();
        });
        this.activeCharts = {};
    },

    _assignToolColors(toolNames) {
        const DISTINCT_COLORS = ['#58A6FF', '#F778BA', '#3FB950', '#A371F7', '#F0B939', '#48D9A4'];
        this.toolColorMap.clear();
        toolNames.forEach((toolName, index) => {
            this.toolColorMap.set(toolName, DISTINCT_COLORS[index % DISTINCT_COLORS.length]);
        });
    },

    _filterDataByTool(dataArray, allLabels, activeLabelsSet) {
        const filtered = { labels: [], data: [] };
        allLabels.forEach((label, i) => {
            if (activeLabelsSet.has(label)) {
                filtered.labels.push(label);
                filtered.data.push(dataArray[i]);
            }
        });
        return filtered;
    }
};
