const { Octokit } = require("@octokit/rest");
const stringSimilarity = require("string-similarity");

// --- Configuration ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TARGET_GITHUB_REPO = process.env.TARGET_GITHUB_REPO;
const SIMILARITY_THRESHOLD = 0.1; // similarity threshold

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

        const [prResponse, reviewComments, issueComments, reviews] = await Promise.all([
            octokit.pulls.get({ owner, repo, pull_number: prNumber }),
            octokit.paginate(octokit.pulls.listReviewComments, { owner, repo, pull_number: prNumber }),
            octokit.paginate(octokit.issues.listComments, { owner, repo, issue_number: prNumber }),
            octokit.paginate(octokit.pulls.listReviews, { owner, repo, pull_number: prNumber })
        ]);

        const prData = prResponse.data;
        const prCreatedAt = parseIsoTimestamp(prData.created_at);
        const linesChanged = prData.additions + prData.deletions;

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

        const fileRanges = {};
        allCommentsList.forEach(item => {
            if (item.path && item.start_line && item.line !== item.start_line) {
                if (!fileRanges[item.path]) {
                    fileRanges[item.path] = [];
                }
                fileRanges[item.path].push({ start: item.start_line, end: item.line });
            }
        });

        for (const item of allCommentsList) {
            const author = item.user?.login;
            if (!author) continue;

            const currentTool = author;
            discoveredTools.add(currentTool);

            const commentBody = item.body || '';
            if (!commentBody) continue;

            let findingKey = "General PR Summary";
            if (item.path && (item.line || item.start_line)) {
                let representativeLine = item.start_line || item.line;
                const rangesInFile = fileRanges[item.path] || [];

                for (const range of rangesInFile) {
                    if (item.line >= range.start && item.line <= range.end) {
                        representativeLine = range.start;
                        break;
                    }
                }
                findingKey = `${item.path}:${representativeLine}`;
            }

            const timestampStr = item.submitted_at || item.created_at;
            const commentCreatedAt = parseIsoTimestamp(timestampStr);
            if (!commentCreatedAt) continue;

            const timeToComment = (commentCreatedAt - prCreatedAt) / 1000;
            if (!reviewTimes[currentTool]) reviewTimes[currentTool] = [];
            reviewTimes[currentTool].push(timeToComment);

            // --- ✅ FIX STARTS HERE ---
            // Updated regex to find 'suggestion' OR 'diff' blocks
            const suggestionMatch = /```(suggestion|diff)\r?\n(.*?)\r?\n```/s.exec(commentBody);
            let originalCode = null;
            let suggestedCode = null;

            // --- Strategy 1: Look for a standard GitHub markdown suggestion block ---
            const markdownRegex = /```suggestion\r?\n([\s\S]*?)```/s;
            const markdownMatch = markdownRegex.exec(commentBody);

            if (markdownMatch) {
                const blockContent = markdownMatch[1];
                const lines = blockContent.split('\n');

                originalCode = lines.filter(l => l.startsWith('-')).map(l => l.substring(1)).join('\n');
                suggestedCode = lines.filter(l => l.startsWith('+')).map(l => l.substring(1)).join('\n');

                // If a suggestion only contains additions, use the diff_hunk to find the original code.
                if (!originalCode && item.diff_hunk) {
                    originalCode = item.diff_hunk.split('\n')
                        .filter(line => line.startsWith('-') && !line.startsWith('---'))
                        .map(line => line.substring(1))
                        .join('\n');
                }
            }
            // --- Strategy 2: If no markdown found, look for Copilot's plain-text format ---
            else if (commentBody.includes('Suggested change') && item.diff_hunk) {
                // In this format, the original code is the line being commented on in the diff.
                const hunkLines = item.diff_hunk.split('\n');
                const originalLine = hunkLines.find(line => line.startsWith('+') && !line.startsWith('+++'));

                if (originalLine) {
                    originalCode = originalLine.substring(1); // Get code by removing the '+' prefix

                    // The suggested code is on the line following the "Suggested change" header.
                    const commentLines = commentBody.split('\n');
                    const headerIndex = commentLines.findIndex(line => line.trim() === 'Suggested change');

                    if (headerIndex !== -1 && headerIndex + 1 < commentLines.length) {
                        const diffLine = commentLines[headerIndex + 1].trim();

                        // The plain-text diff often includes the original code and the new code mashed together.
                        // We can attempt to isolate the new code by removing the original part from the start.
                        const originalTrimmed = originalCode.trim();
                        if (diffLine.startsWith(originalTrimmed)) {
                            suggestedCode = diffLine.substring(originalTrimmed.length).trim();
                        } else {
                            // If the format is unexpected, we cannot reliably parse it.
                            suggestedCode = null;
                        }
                    }
                }
            }
            // --- ✅ FIX ENDS HERE ---

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

        const novelFindingCount = {};
        for (const location in findingsMap) {
            const reviewsList = findingsMap[location];
            if (reviewsList.length <= 1) {
                if(reviewsList.length === 1) {
                    reviewsList[0].is_novel = true;
                }
                continue;
            }

            reviewsList.forEach(r => r.is_novel = false);

            for (let i = 0; i < reviewsList.length; i++) {
                let isNovel = true;
                for (let j = 0; j < reviewsList.length; j++) {
                    if (i === j) continue;

                    const similarity = stringSimilarity.compareTwoStrings(
                        reviewsList[i].comment,
                        reviewsList[j].comment
                    );

                    if (similarity >= SIMILARITY_THRESHOLD) {
                        isNovel = false;
                        break;
                    }
                }
                if (isNovel) {
                    reviewsList[i].is_novel = true;
                }
            }
        }

        const processedFindings = [];
        const categoryCounts = {};
        const toolFindingCounts = {};
        const findingsPerFile = {};
        const overlapCounts = {};
        const toolCategoryCounts = {}

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
                const tool = review.tool;
                toolFindingCounts[tool] = (toolFindingCounts[tool] || 0) + 1;
                if (review.is_novel) {
                    novelFindingCount[tool] = (novelFindingCount[tool] || 0) + 1;
                }
                if (!toolCategoryCounts[tool]) toolCategoryCounts[tool] = {};
                toolCategoryCounts[tool][category] = (toolCategoryCounts[tool][category] || 0) + 1;
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
                tool_names: finalToolList,
                lines_changed: linesChanged
            },
            summary_charts: {
                findings_by_tool: finalToolList.map(tool => toolFindingCounts[tool] || 0),
                findings_by_category: { labels: Object.keys(categoryCounts), data: Object.values(categoryCounts) },
                comment_verbosity: { labels: finalToolList, data: finalToolList.map(tool => getAvg(commentLengths, tool)) },
                findings_by_file: { labels: Object.keys(findingsPerFile), data: Object.values(findingsPerFile) },
                review_speed: { labels: finalToolList, data: finalToolList.map(tool => getAvg(reviewTimes, tool)) },
                suggestion_overlap: overlapDataForJson,
                novelty_score: finalToolList.map(tool => {
                    const total = toolFindingCounts[tool] || 0;
                    const novel = novelFindingCount[tool] || 0;
                    return total > 0 ? Math.round((novel / total) * 100) : 0;
                }),
                findings_density: finalToolList.map(tool => {
                    const total = toolFindingCounts[tool] || 0;
                    return linesChanged > 0 ? (total / linesChanged) * 100 : 0;
                }),
                tool_strength_profile: {
                    tool_names: finalToolList,
                    categories: Object.keys(categoryCounts),
                    data: finalToolList.map(tool => {
                        const counts = toolCategoryCounts[tool] || {};
                        return Object.keys(categoryCounts).map(cat => counts[cat] || 0);
                    })
                }
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
