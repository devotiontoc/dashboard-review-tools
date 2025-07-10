const { Octokit } = require("@octokit/rest");

// --- Configuration ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TARGET_GITHUB_REPO = process.env.TARGET_GITHUB_REPO;

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
        const discoveredTools = new Set();

        const [prData, reviewComments, issueComments, reviews] = await Promise.all([
            octokit.pulls.get({ owner, repo, pull_number: prNumber }),
            octokit.paginate(octokit.pulls.listReviewComments, { owner, repo, pull_number: prNumber }),
            octokit.paginate(octokit.issues.listComments, { owner, repo, issue_number: prNumber }),
            octokit.paginate(octokit.pulls.listReviews, { owner, repo, pull_number: prNumber })
        ]);

        const prCreatedAt = parseIsoTimestamp(prData.data.created_at);
        const allItems = new Map();

        [...reviewComments, ...issueComments].forEach(item => allItems.set(item.id, item));

        const reviewCommentPromises = reviews.map(review => {
            if (review.body) {
                allItems.set(`review-summary-${review.id}`, review);
            }
            return octokit.paginate(octokit.pulls.listReviewComments, { owner, repo, pull_number: prNumber, review_id: review.id });
        });

        const commentsFromReviews = await Promise.all(reviewCommentPromises);

        commentsFromReviews.flat().forEach(comment => allItems.set(comment.id, comment));

        console.log(`Successfully fetched a total of ${allItems.size} unique comments and review summaries.`);

        const allCommentsList = Array.from(allItems.values());
        const findingsMap = {};
        const commentLengths = {};
        const reviewTimes = {};

        // --- ✅ NEW TWO-PASS GROUPING LOGIC ---

        // PASS 1: Identify all unique multi-line comment ranges.
        const fileRanges = {}; // E.g., { 'path/to/file.js': [{ start: 9, end: 13 }, ...] }
        allCommentsList.forEach(item => {
            if (item.path && item.start_line && item.line !== item.start_line) {
                if (!fileRanges[item.path]) {
                    fileRanges[item.path] = [];
                }
                fileRanges[item.path].push({ start: item.start_line, end: item.line });
            }
        });

        // PASS 2: Group all comments, checking against the ranges found in Pass 1.
        for (const item of allCommentsList) {
            const author = item.user?.login;
            if (!author) continue;

            const currentTool = author;
            discoveredTools.add(currentTool);

            const commentBody = item.body || '';
            if (!commentBody) continue;

            // --- Grouping Key Logic ---
            let findingKey = "General PR Summary";
            if (item.path && (item.line || item.start_line)) {
                let representativeLine = item.start_line || item.line;
                const rangesInFile = fileRanges[item.path] || [];

                // Check if this comment's line falls within an established multi-line range.
                for (const range of rangesInFile) {
                    // Use item.line as it represents the comment's actual position.
                    if (item.line >= range.start && item.line <= range.end) {
                        representativeLine = range.start; // Group by the start of the range.
                        break;
                    }
                }
                findingKey = `${item.path}:${representativeLine}`;
            }
            // --- End Grouping Key Logic ---

            const timestampStr = item.submitted_at || item.created_at;
            const commentCreatedAt = parseIsoTimestamp(timestampStr);
            if (!commentCreatedAt) continue;

            const timeToComment = (commentCreatedAt - prCreatedAt) / 1000;
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

        // --- The rest of the script for processing and output remains the same ---
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

        const finalToolList = Array.from(discoveredTools).sort();

        const finalOutput = {
            metadata: {
                repo: TARGET_GITHUB_REPO,
                pr_number: parseInt(prNumber),
                tool_names: finalToolList
            },
            summary_charts: {
                findings_by_tool: finalToolList.map(tool => toolFindingCounts[tool] || 0),
                findings_by_category: { labels: Object.keys(categoryCounts), data: Object.values(categoryCounts) },
                comment_verbosity: { labels: finalToolList, data: finalToolList.map(tool => getAvg(commentLengths, tool)) },
                findings_by_file: { labels: Object.keys(findingsPerFile), data: Object.values(findingsPerFile) },
                review_speed: { labels: finalToolList, data: finalToolList.map(tool => getAvg(reviewTimes, tool)) },
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