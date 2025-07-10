document.addEventListener('DOMContentLoaded', function() {
    const prSelect = document.getElementById('pr-select');
    const fetchButton = document.getElementById('fetch-button');
    const loader = document.getElementById('loader');
    const dashboardContent = document.getElementById('dashboard-content');
    const errorDisplay = document.getElementById('error-display');

    let activeCharts = [];

    // 1. Fetch open pull requests on page load
    async function getPullRequests() {
        try {
            const response = await fetch('/api/get-pull-requests');
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to fetch PRs.');
            }
            const prs = await response.json();

            if (prs.length > 0) {
                prSelect.innerHTML = prs.map(pr => `<option value="${pr.number}">#${pr.number}: ${pr.title}</option>`).join('');
                fetchButton.disabled = false;
                fetchButton.textContent = "Fetch Analysis";
            } else {
                prSelect.innerHTML = `<option value="">No open PRs found</option>`;
                fetchButton.disabled = true;
                fetchButton.textContent = "No PRs to Analyze";
            }
        } catch (error) {
            console.error("Error fetching pull requests:", error);
            prSelect.innerHTML = `<option value="">Error loading PRs</option>`;
            fetchButton.disabled = true;
            showError(`Could not load Pull Requests from repository. ${error.message}`);
        }
    }

    // 2. Add event listener to the fetch button
    fetchButton.addEventListener('click', async () => {
        const prNumber = prSelect.value;
        if (!prNumber) {
            alert("Please select a Pull Request.");
            return;
        }

        // --- UI Reset ---
        loader.style.display = 'block';
        fetchButton.disabled = true;
        dashboardContent.style.display = 'none';
        errorDisplay.style.display = 'none';
        activeCharts.forEach(chart => chart.destroy());
        activeCharts = [];

        try {
            const response = await fetch(`/api/aggregate-pr?pr=${prNumber}`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Aggregation failed with status: ${response.status}`);
            }
            const results = await response.json();
            console.log("RESULTS FROM API:", results);
            renderCharts(results);
            renderFindings(results);
            dashboardContent.style.display = 'block';

        } catch (error) {
            console.error("Error during aggregation:", error);
            showError(`An error occurred while analyzing PR #${prNumber}: ${error.message}`);
        } finally {
            loader.style.display = 'none';
            fetchButton.disabled = false;
        }
    });

    function showError(message) {
        dashboardContent.style.display = 'none';
        errorDisplay.textContent = message;
        errorDisplay.style.display = 'block';
    }

    // --- Initial Load ---
    getPullRequests();


    // --- All of your original rendering functions go below ---

    function renderCharts(results) {
        const { tool_names } = results.metadata;
        const {
            findings_by_tool, findings_by_category, comment_verbosity,
            findings_by_file, review_speed, suggestion_overlap
        } = results.summary_charts;
        const COLORS = ['#38BDF8', '#F472B6', '#A78BFA', '#34D399', '#FBBF24', '#F87171'];
        const commonChartOptions = (indexAxis = 'x') => ({
            indexAxis,
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#9CA3AF' }, grid: { color: 'rgba(55, 65, 81, 0.5)' } },
                y: { ticks: { color: '#9CA3AF' }, grid: { color: 'rgba(55, 65, 81, 0.5)' } }
            }
        });

        activeCharts.push(new Chart(document.getElementById('findingsByToolChart'), {
            type: 'bar',
            data: { labels: tool_names, datasets: [{ label: 'Number of Findings', data: findings_by_tool, backgroundColor: COLORS }] },
            options: commonChartOptions('y')
        }));
        activeCharts.push(new Chart(document.getElementById('findingsByCategoryChart'), {
            type: 'doughnut',
            data: { labels: findings_by_category.labels, datasets: [{ data: findings_by_category.data, backgroundColor: ['#991B1B', '#166534', '#9A3412', '#1E40AF'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { color: '#D1D5DB' } } } }
        }));
        activeCharts.push(new Chart(document.getElementById('findingsByFileChart'), {
            type: 'bar',
            data: { labels: findings_by_file.labels, datasets: [{ label: 'Number of Findings', data: findings_by_file.data, backgroundColor: '#A78BFA' }] },
            options: commonChartOptions('y')
        }));
        activeCharts.push(new Chart(document.getElementById('commentVerbosityChart'), {
            type: 'bar',
            data: { labels: comment_verbosity.labels, datasets: [{ label: 'Average Characters per Comment', data: comment_verbosity.data, backgroundColor: '#34D399' }] },
            options: commonChartOptions()
        }));
        activeCharts.push(new Chart(document.getElementById('reviewSpeedChart'), {
            type: 'bar',
            data: { labels: review_speed.labels, datasets: [{ label: 'Avg Time to Comment (s)', data: review_speed.data, backgroundColor: '#FBBF24' }] },
            options: commonChartOptions()
        }));

        const overlapCtx = document.getElementById('suggestionOverlapChart').getContext('2d');
        const topOverlaps = suggestion_overlap.filter(item => item.sets.length > 1).sort((a, b) => b.size - a.size).slice(0, 3);
        if (topOverlaps.length > 0) {
            document.getElementById('suggestionOverlapChart').style.display = 'block';
            activeCharts.push(new Chart(overlapCtx, {
                type: 'bar',
                data: {
                    labels: topOverlaps.map(d => d.sets.join(' & ')), // The labels are the tool names
                    datasets: [{
                        label: 'Overlapping Findings',
                        data: topOverlaps.map(d => d.size), // The data is the numeric count
                        backgroundColor: '#F87171'
                    }]
                },
                options: commonChartOptions('y')
            }));
        } else {
            document.getElementById('suggestionOverlapChart').style.display = 'none';
        }
    }

    function renderFindings(results) {
        const container = document.getElementById('detailed-findings');
        container.innerHTML = `<h2>Consolidated Findings</h2>`; // Reset
        if (!results.findings || results.findings.length === 0) {
            container.innerHTML += '<p class="no-data-message">No findings were reported by the automated tools for this pull request.</p>';
            return;
        }

        results.findings.forEach(finding => {
            const card = document.createElement('div');
            card.className = 'finding-card';
            let reviewsHTML = '';
            finding.reviews.forEach(review => {
                const toolClassName = review.tool.replace(/\s+/g, '-');
                let diffHTML = '';
                if (review.original_code && review.suggested_code) {
                    const diffString = `--- a/${finding.location}\n+++ b/${finding.location}\n${review.original_code.split('\n').map(l => `-${l}`).join('\n')}\n${review.suggested_code.split('\n').map(l => `+${l}`).join('\n')}`;
                    diffHTML = Diff2Html.html(diffString, {
                        drawFileList: false,
                        matching: 'lines',
                        outputFormat: 'side-by-side'
                    });
                }
                reviewsHTML += `
                    <div class="tool-review ${toolClassName}">
                        <h4>${review.tool}</h4>
                        <blockquote>${escapeHtml(review.comment)}</blockquote>
                        ${diffHTML ? `<div class="diff-container">${diffHTML}</div>` : ''}
                    </div>`;
            });
            card.innerHTML = `
                <div class="finding-card-header">
                    <h3><code>${finding.location}</code></h3>
                    <span class="category ${finding.category.toLowerCase().replace(/ /g, '-')}">${finding.category}</span>
                </div>
                <div class="finding-card-body">${reviewsHTML}</div>`;
            container.appendChild(card);
        });
    }

    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') { return ''; }
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
});