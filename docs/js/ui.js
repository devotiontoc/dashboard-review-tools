import { ChartManager } from './charts.js';

/**
 * Manages all UI interactions, DOM updates, and event handling.
 */
export class UIManager {
    /**
     * @param {object} callbacks - Functions to call for specific events (e.g., onFetchAnalysis).
     */
    constructor({ onFetchAnalysis, onFilterChange, onExport, onCategoryChartClick }) {
        this.callbacks = { onFetchAnalysis, onFilterChange, onExport, onCategoryChartClick };
        this.elements = {};
        this.currentViewMode = 'side-by-side';

        this._initSelectors();
        this._initEventListeners();
    }

    /**
     * Caches all necessary DOM element references for performance.
     */
    _initSelectors() {
        this.elements.prSelect = document.getElementById('pr-select');
        this.elements.fetchButton = document.getElementById('fetch-button');
        this.elements.loader = document.getElementById('loader');
        this.elements.errorDisplay = document.getElementById('error-display');
        this.elements.dashboardControls = document.getElementById('dashboard-controls');
        this.elements.toolFilterContainer = document.getElementById('tool-filter-container');
        this.elements.exportButton = document.getElementById('export-csv-button');
        this.elements.navLinks = document.querySelectorAll('.nav-link');
        this.elements.views = document.querySelectorAll('.app-view');
        this.elements.tabs = document.querySelectorAll('.tab-link');
        this.elements.tabContents = document.querySelectorAll('.tab-content');
        this.elements.findingsContainer = document.getElementById('detailed-findings-container');
        this.elements.viewSideBySideBtn = document.getElementById('view-side-by-side');
        this.elements.viewUnifiedBtn = document.getElementById('view-unified');
        this.elements.kpiTotalFindings = document.getElementById('kpi-total-findings');
        this.elements.kpiLinesAnalyzed = document.getElementById('kpi-lines-analyzed');
        this.elements.kpiAvgNovelty = document.getElementById('kpi-avg-novelty');
    }

    /**
     * Sets up all global event listeners for the application.
     */
    _initEventListeners() {
        this.elements.fetchButton.addEventListener('click', () => this.callbacks.onFetchAnalysis());
        this.elements.exportButton.addEventListener('click', () => this.callbacks.onExport());

        this.elements.navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView(link.getAttribute('data-view'));
            });
        });

        this.elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchTab(tab.getAttribute('data-tab'));
            });
        });

        this.elements.viewSideBySideBtn.addEventListener('click', () => this._updateFindingsView('side-by-side'));
        this.elements.viewUnifiedBtn.addEventListener('click', () => this._updateFindingsView('unified'));

        // Pass the callback to the ChartManager so it can attach it to the chart's onClick event.
        ChartManager.setCategoryClickHandler(this.callbacks.onCategoryChartClick);
    }

    /**
     * Fetches the list of pull requests from the API and populates the dropdown.
     */
    async getPullRequests() {
        try {
            const response = await fetch('/api/get-pull-requests');
            if (!response.ok) throw new Error('Failed to fetch pull requests from GitHub.');
            const prs = await response.json();

            if (prs.length > 0) {
                this.elements.prSelect.innerHTML = prs.map(pr => `<option value="${pr.number}">#${pr.number}: ${pr.title}</option>`).join('');
                this.elements.fetchButton.disabled = false;
            } else {
                this.elements.prSelect.innerHTML = `<option value="">No open PRs found</option>`;
                this.elements.fetchButton.disabled = true;
            }
        } catch (error) {
            this.showError(error.message);
        }
    }

    /**
     * Renders all UI components after new data is fetched.
     * @param {object} results - The full analysis data from the API.
     * @param {object} filters - The current active filters state.
     */
    renderAll(results, filters) {
        this.switchView('dashboard');
        this.switchTab('overview');
        this.elements.dashboardControls.style.display = 'flex';
        this.renderFilters(results.metadata.tool_names, filters.tools);
        this.updateKPIs(results, filters);
        this.renderFindings(results, filters);
    }

    /**
     * Updates UI elements that change when filters are applied, without a full data refetch.
     * @param {object} results - The full analysis data.
     * @param {object} filters - The current active filters state.
     */
    updateOnFilter(results, filters) {
        this.updateKPIs(results, filters);
        this.renderFindings(results, filters);
    }

    toggleLoading(isLoading) {
        this.elements.loader.style.display = isLoading ? 'block' : 'none';
        this.elements.fetchButton.disabled = isLoading;
        if (isLoading) {
            this.showError(''); // Clear previous errors on new fetch
        }
    }

    showError(message) {
        this.elements.errorDisplay.textContent = message;
        this.elements.errorDisplay.style.display = message ? 'block' : 'none';
    }

    getSelectedPR() {
        return this.elements.prSelect.value;
    }

    switchView(viewName) {
        this.elements.views.forEach(view => view.classList.remove('active'));
        document.getElementById(`view-${viewName}`).classList.add('active');
        this.elements.navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('data-view') === viewName));
    }

    switchTab(tabName) {
        this.elements.tabContents.forEach(content => content.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        this.elements.tabs.forEach(tab => tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName));
    }

    /**
     * Renders the tool filter checkboxes in the header.
     * @param {string[]} toolNames - An array of all available tool names.
     * @param {Set<string>} activeTools - A set of currently active tool names.
     */
    renderFilters(toolNames, activeTools) {
        const container = this.elements.toolFilterContainer;
        container.innerHTML = '<label>Filter by Tool:</label>'; // Reset content
        toolNames.forEach(tool => {
            const isChecked = activeTools.has(tool);
            const checkboxHTML = `
                <label class="filter-checkbox">
                    <input type="checkbox" data-tool="${tool}" ${isChecked ? 'checked' : ''}>
                    <span>${tool}</span>
                </label>
            `;
            container.insertAdjacentHTML('beforeend', checkboxHTML);
        });

        // Add event listeners to the newly created checkboxes
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const selectedTools = new Set();
                container.querySelectorAll('input:checked').forEach(cb => {
                    selectedTools.add(cb.dataset.tool);
                });
                this.callbacks.onFilterChange(selectedTools);
            });
        });
    }

    /**
     * Updates the Key Performance Indicator (KPI) cards based on current filters.
     */
    updateKPIs(results, filters) {
        const filteredFindings = results.findings.flatMap(f => f.reviews).filter(r => filters.tools.has(r.tool));
        const totalFindings = filteredFindings.length;

        const novelScores = filteredFindings.filter(r => r.is_novel).length;
        const avgNovelty = totalFindings > 0 ? (novelScores / totalFindings) * 100 : 0;

        this.elements.kpiTotalFindings.textContent = totalFindings;
        this.elements.kpiLinesAnalyzed.textContent = results.metadata.lines_changed;
        this.elements.kpiAvgNovelty.textContent = `${avgNovelty.toFixed(0)}%`;
    }

    /**
     * Renders the detailed findings cards based on the current view mode and filters.
     */
    renderFindings(results, filters) {
        this.elements.findingsContainer.innerHTML = '';
        const filteredFindings = results.findings
            .map(finding => ({
                ...finding,
                reviews: finding.reviews.filter(review => filters.tools.has(review.tool))
            }))
            .filter(finding => finding.reviews.length > 0);

        if (filteredFindings.length === 0) {
            this.elements.findingsContainer.innerHTML = '<p class="no-data-message">No findings match the current filters.</p>';
            return;
        }

        filteredFindings.forEach(finding => {
            const hasSuggestion = finding.reviews.some(r => r.suggested_code);
            const card = (this.currentViewMode === 'unified' && hasSuggestion)
                ? this._createUnifiedCard(finding)
                : this._createSideBySideCard(finding);
            this.elements.findingsContainer.appendChild(card);
        });
    }

    _updateFindingsView(viewMode) {
        this.currentViewMode = viewMode;
        this.elements.viewSideBySideBtn.classList.toggle('active', viewMode === 'side-by-side');
        this.elements.viewUnifiedBtn.classList.toggle('active', viewMode === 'unified');

        // Trigger a re-render by calling the filter change handler with the current selection
        const currentlySelectedTools = new Set(
            Array.from(this.elements.toolFilterContainer.querySelectorAll('input:checked')).map(cb => cb.dataset.tool)
        );
        this.callbacks.onFilterChange(currentlySelectedTools);
    }

    _createSideBySideCard(finding) {
        const card = document.createElement('div');
        card.className = 'finding-card';
        const toolColorMap = ChartManager.getToolColorMap();

        let reviewsHTML = '';
        finding.reviews.forEach(review => {
            const toolColor = toolColorMap.get(review.tool) || '#8B949E';
            const noveltyBadge = review.is_novel ? '<span class="novelty-badge">✨ Novel</span>' : '';
            let diffHTML = '';
            if (review.original_code && review.suggested_code) {
                const diffString = `--- a\n+++ b\n${review.original_code.split('\n').map(l => `-${l}`).join('\n')}\n${review.suggested_code.split('\n').map(l => `+${l}`).join('\n')}`;
                diffHTML = Diff2Html.html(diffString, { drawFileList: false, matching: 'lines', outputFormat: 'side-by-side' });
            }
            const commentText = this._escapeHtml(review.comment.replace(/```(suggestion|diff)[\s\S]*?```/s, ''));
            reviewsHTML += `
                <div class="tool-review">
                    <h4 style="border-color: ${toolColor};"><span>${review.tool}</span>${noveltyBadge}</h4>
                    <blockquote>${commentText}</blockquote>
                    ${diffHTML ? `<div class="diff-container">${diffHTML}</div>` : ''}
                </div>`;
        });

        card.innerHTML = `
            <div class="finding-card-header">
                <h3><code>${this._escapeHtml(finding.location)}</code></h3>
                <span class="category ${this._escapeHtml(finding.category.toLowerCase().replace(/\s+/g, '-'))}">${this._escapeHtml(finding.category)}</span>
            </div>
            <div class="finding-card-body">${reviewsHTML}</div>`;
        return card;
    }

    _createUnifiedCard(finding) {
        const card = document.createElement('div');
        card.className = 'finding-card';
        const toolColorMap = ChartManager.getToolColorMap();
        const reviewsWithSuggestions = finding.reviews.filter(r => r.suggested_code);
        const reviewsWithoutSuggestions = finding.reviews.filter(r => !r.suggested_code);
        const originalCode = reviewsWithSuggestions[0]?.original_code || '';

        let unifiedDiffHTML = `<div class="unified-diff-container"><table class="unified-diff-table"><tbody>`;
        originalCode.split('\n').forEach(line => {
            unifiedDiffHTML += `<tr class="line-orig"><td class="line-num">-</td><td class="tool-name-cell"></td><td class="line-code">${this._escapeHtml(line)}</td></tr>`;
        });
        reviewsWithSuggestions.forEach(review => {
            const toolColor = toolColorMap.get(review.tool) || '#8B949E';
            review.suggested_code.split('\n').forEach((line, i) => {
                const toolName = i === 0 ? `<span style="color:${toolColor};">${this._escapeHtml(review.tool)}</span>` : '';
                unifiedDiffHTML += `<tr class="line-sugg"><td class="line-num">+</td><td class="tool-name-cell">${toolName}</td><td class="line-code">${this._escapeHtml(line)}</td></tr>`;
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
                        <h4><span>${this._escapeHtml(review.tool)}</span>${noveltyBadge}</h4>
                        <blockquote>${this._escapeHtml(review.comment)}</blockquote>
                    </div>`;
            });
            otherCommentsHTML += '</div>';
        }

        card.innerHTML = `
            <div class="finding-card-header">
                <h3><code>${this._escapeHtml(finding.location)}</code></h3>
                <span class="category ${this._escapeHtml(finding.category.toLowerCase().replace(/ /g, '-'))}">${this._escapeHtml(finding.category)}</span>
            </div>
            <div class="finding-card-body unified">${unifiedDiffHTML}${otherCommentsHTML}</div>`;
        return card;
    }

    _escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
}
