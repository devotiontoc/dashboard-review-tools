import { ChartManager } from './charts.js';
import { UIManager } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    // =================================================================
    // APPLICATION STATE
    // =================================================================
    let currentAnalysisResults = null;
    let activeFilters = {
        tools: new Set(),
        category: null // For interactive chart filtering
    };

    // =================================================================
    // INITIALIZATION
    // =================================================================

    // Initialize Chart.js with global settings (fixes legend colors)
    ChartManager.init();

    // Initialize the UI Manager with callbacks for user actions
    const ui = new UIManager({
        onFetchAnalysis: fetchAnalysis,
        onFilterChange: handleFilterChange,
        onExport: exportData,
        onCategoryChartClick: handleCategoryFilter
    });

    // Fetch the initial list of pull requests
    ui.getPullRequests();


    // =================================================================
    // CORE LOGIC
    // =================================================================

    /**
     * Fetches and processes the main analysis data for a selected PR.
     */
    async function fetchAnalysis() {
        ui.toggleLoading(true);
        ChartManager.showSkeletons(true); // Show skeleton loaders for charts

        try {
            const prNumber = ui.getSelectedPR();
            const response = await fetch(`/api/aggregate-pr?pr=${prNumber}`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Aggregation failed.');
            }

            currentAnalysisResults = await response.json();

            // Reset filters to default (all tools selected, no category filter)
            const toolNames = currentAnalysisResults.metadata.tool_names;
            activeFilters.tools = new Set(toolNames);
            activeFilters.category = null;

            // Render the entire dashboard with the new data
            ui.renderAll(currentAnalysisResults, activeFilters);
            ChartManager.renderAll(currentAnalysisResults, activeFilters);

            // Asynchronously save results without blocking the UI
            saveAnalysis(currentAnalysisResults);

        } catch (error) {
            ui.showError(`Failed to analyze PR: ${error.message}`);
            ui.switchView('initial'); // Revert to welcome screen on error
        } finally {
            ui.toggleLoading(false);
            ChartManager.showSkeletons(false); // Hide skeletons
        }
    }

    /**
     * Handles changes from the tool filter checkboxes.
     * @param {Set<string>} selectedTools - A set of tool names that are checked.
     */
    function handleFilterChange(selectedTools) {
        activeFilters.tools = selectedTools;
        if (currentAnalysisResults) {
            // Re-render all components with the new filters
            ui.updateOnFilter(currentAnalysisResults, activeFilters);
            ChartManager.renderAll(currentAnalysisResults, activeFilters);
        }
    }

    /**
     * Handles clicks on the category chart for cross-filtering.
     * @param {string|null} category - The category name to filter by, or null to reset.
     */
    function handleCategoryFilter(category) {
        // Toggle filter: if same category is clicked again, reset it.
        activeFilters.category = activeFilters.category === category ? null : category;

        if (currentAnalysisResults) {
            // Re-render only the charts affected by this filter
            ChartManager.updateToolStrengthChart(currentAnalysisResults, activeFilters);
        }
    }

    /**
     * Exports the detailed findings data to a CSV file.
     */
    function exportData() {
        if (!currentAnalysisResults || !currentAnalysisResults.findings) {
            ui.showError("No data available to export.");
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,";
        // Define headers
        csvContent += "Location,Category,Tool,Is Novel,Comment\n";

        // Create rows
        currentAnalysisResults.findings.forEach(finding => {
            finding.reviews.forEach(review => {
                // Sanitize data for CSV
                const location = `"${finding.location.replace(/"/g, '""')}"`;
                const category = `"${finding.category.replace(/"/g, '""')}"`;
                const tool = `"${review.tool.replace(/"/g, '""')}"`;
                const isNovel = review.is_novel;
                const comment = `"${review.comment.replace(/"/g, '""').replace(/\n/g, ' ')}"`; // Replace newlines

                const row = [location, category, tool, isNovel, comment].join(",");
                csvContent += row + "\n";
            });
        });

        // Trigger download
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `pr-${currentAnalysisResults.metadata.pr_number}-findings.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Saves the analysis results to the backend database.
     * @param {object} results - The analysis data.
     */
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
});
