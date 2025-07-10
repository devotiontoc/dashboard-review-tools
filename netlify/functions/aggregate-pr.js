const { Octokit } = require("@octokit/rest");

// --- Configuration ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TARGET_GITHUB_REPO = process.env.TARGET_GITHUB_REPO;

const TOOL_IDENTIFIERS = {
    'CodeRabbit': 'coderabbitai[bot]',
    'BitoAI': 'bito-code-review[bot]',
    'Codacy': 'codacy-production[bot]',
    'GitHub Copilot': 'copilot-pull-request-reviewer[bot]',
    'devotiontoc': 'devotiontoc',
};
const TOOLS = Object.keys(TOOL_IDENTIFIERS);

// --- Helper Functions ---
function parseIsoTimestamp(tsStr) {
    if (!tsStr) return null;
    return new Date(tsStr);
}

function categorizeComment(commentText) {
    const text = commentText.toLowerCase();
    if (['security', 'vulnerability', 'cve', 'sql injection', 'xss', 'hardcoded secret'].some(kw => text.includes(kw))) {
        return "Security";
    }
    if (['performance', 'slow', 'efficient', 'optimize'].some(kw => text.includes(kw))) {
        return "Performance";
    }
    if (['bug', 'error', 'null pointer', 'exception', 'leak'].some(kw => text.includes(kw))) {
        return "Bug";
    }
    return "Style / Best Practice";
}

// --- Main Handler ---
exports.handler = async function(event, context) {
    const prNumber = event.queryStringParameters.pr;
    if (!prNumber) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Pull Request number is required.' }) };
    }
    if (!GITHUB_TOKEN || !TARGET_GITHUB_REPO) {
        return { statusCode: 500, body: JSON.stringify({ error: "Missing environment variables." }) };
    }

    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const [owner, repo] = TARGET_GITHUB_REPO.split('/');

    try {
        // --- 🚀 OPTIMIZATION 1: Fetch initial data in parallel ---
        const [prData, reviewComments, issueComments, reviews] = await Promise.all([
            octokit.pulls.get({ owner, repo, pull_number: prNumber }),
            octokit.paginate(octokit.pulls.listReviewComments, { owner, repo, pull_number: prNumber }),
            octokit.paginate(octokit.issues.listComments, { owner, repo, issue_number: prNumber }),
            octokit.paginate(octokit.pulls.listReviews, { owner, repo, pull_number: prNumber })
        ]);

        const prCreatedAt = parseIsoTimestamp(prData.data.created_at);
        const allItems = new Map();

        // Add all fetched top-level comments to the map
        [...reviewComments, ...issueComments].forEach(item => allItems.set(item.id, item));

        // --- 🚀 OPTIMIZATION 2: Fetch comments for reviews in parallel ---
        const reviewCommentPromises = reviews.map(review => {
            // Add the review summary body itself
            if (review.body) {
                allItems.set(`review-summary-${review.id}`, review);
            }
            // Only fetch comments for reviews that have them (GitHub's API for this is tricky, so we fetch all)
            return octokit.paginate(octokit.pulls.listReviewComments, { owner, repo, pull_number: prNumber, review_id: review.id });
        });

        // Wait for all the comment requests to complete
        const commentsFromReviews = await Promise.all(reviewCommentPromises);

        // Flatten the array of arrays and add the comments to our map
        commentsFromReviews.flat().forEach(comment => allItems.set(comment.id, comment));

        console.log(`Successfully fetched a total of ${allItems.size} unique comments and review summaries.`);

        // --- The rest of the function remains the same ---
        const findingsMap = {};
        const commentLengths = {};
        const reviewTimes = {};

        for (const item of allItems.values()) {
            const author = item.user?.login;
            const currentTool = TOOLS.find(name => TOOL_IDENTIFIERS[name] === author);
            if (!currentTool) continue;

            const commentBody = item.body || '';
            if (!commentBody) continue;

            const timestampStr = item.submitted_at || item.created_at;
            const commentCreatedAt = parseIsoTimestamp(timestampStr);
            if (!commentCreatedAt) continue;

            const timeToComment = (commentCreatedAt - prCreatedAt) / 1000; // in seconds
            if (!reviewTimes[currentTool]) reviewTimes[currentTool] = [];
            reviewTimes[currentTool].push(timeToComment);

            const suggestionMatch = /```suggestion\r?\n(.*?)\r?\n```/s.exec(commentBody);
            let originalCode = null, suggestedCode = null;
            if (suggestionMatch) {
                suggestedCode = suggestionMatch[1];
                if (item.diff_hunk) {
                    originalCode = item.diff_hunk.split('\n')
                        .filter(line => line.startsWith('-') && !line.startsWith('---'))
                        .map(line => line.substring(1))
                        .join('\n');
                }
            }

            const filePath = item.path;
            const line = item.line || item.start_line;
            const findingKey = (filePath && line) ? `${filePath}:${line}` : "General PR Summary";

            if (!findingsMap[findingKey]) findingsMap[findingKey] = [];
            findingsMap[findingKey].push({
                tool: currentTool,
                comment: commentBody,
                original_code: originalCode,
                suggested_code: suggestedCode
            });

            if (!commentLengths[currentTool]) commentLengths[currentTool] = [];
            commentLengths[currentTool].push(commentBody.length);
        }

        const processedFindings = [];
        const categoryCounts = {};
        const toolFindingCounts = {};
        const findingsPerFile = {};
        const overlapCounts = {};

        for (const [location, reviewsList] of Object.entries(findingsMap)) {
            const reviewTools = new Set(reviewsList.map(r => r.tool));
            if (reviewTools.size > 1) {
                const sortedTools = Array.from(reviewTools).sort();
                for (let i = 0; i < sortedTools.length; i++) {
                    for (let j = i + 1; j < sortedTools.length; j++) {
                        const pair = [sortedTools[i], sortedTools[j]];
                        const key = pair.join(' & ');
                        overlapCounts[key] = (overlapCounts[key] || 0) + 1;
                    }
                }
            }

            const allCommentsText = reviewsList.map(r => r.comment).join(" ");
            const category = categorizeComment(allCommentsText);
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;

            if (location !== "General PR Summary") {
                const file = location.split(':')[0];
                findingsPerFile[file] = (findingsPerFile[file] || 0) + 1;
            }

            reviewsList.forEach(review => {
                toolFindingCounts[review.tool] = (toolFindingCounts[review.tool] || 0) + 1;
            });

            processedFindings.push({ location, category, reviews: reviewsList });
        }

        const getAvg = (dataDict, key) => {
            const items = dataDict[key] || [];
            return items.length > 0 ? Math.round(items.reduce((a, b) => a + b, 0) / items.length) : 0;
        };

        const overlapDataForJson = Object.entries(overlapCounts).map(([sets, count]) => ({
            sets: sets.split(' & '),
            size: count
        }));

        const finalOutput = {
            metadata: { repo: TARGET_GITHUB_REPO, pr_number: parseInt(prNumber), tool_names: TOOLS },
            summary_charts: {
                findings_by_tool: TOOLS.map(tool => toolFindingCounts[tool] || 0),
                findings_by_category: { labels: Object.keys(categoryCounts), data: Object.values(categoryCounts) },
                comment_verbosity: { labels: TOOLS, data: TOOLS.map(tool => getAvg(commentLengths, tool)) },
                findings_by_file: { labels: Object.keys(findingsPerFile), data: Object.values(findingsPerFile) },
                review_speed: { labels: TOOLS, data: TOOLS.map(tool => getAvg(reviewTimes, tool)) },
                suggestion_overlap: overlapDataForJson
            },
            findings: processedFindings
        };

        return {
            statusCode: 200,
            body: JSON.stringify(finalOutput),
        };

    } catch (error) {
        console.error("Aggregation Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Failed to process PR #${prNumber}. Details: ${error.message}` }),
        };
    }
};