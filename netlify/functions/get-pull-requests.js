const { Octokit } = require("@octokit/rest");

exports.handler = async function(event, context) {
    // These are set in the Netlify UI, not committed to your repo
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const TARGET_GITHUB_REPO = process.env.TARGET_GITHUB_REPO;

    if (!GITHUB_TOKEN || !TARGET_GITHUB_REPO) {
        return { statusCode: 500, body: JSON.stringify({ error: "Missing environment variables." }) };
    }

    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const [owner, repo] = TARGET_GITHUB_REPO.split('/');

    try {
        const { data: pullRequests } = await octokit.pulls.list({
            owner,
            repo,
            state: 'open',
            sort: 'created',
            direction: 'desc'
        });

        // We only need the number and title for the dropdown
        const prList = pullRequests.map(pr => ({
            number: pr.number,
            title: pr.title
        }));

        return {
            statusCode: 200,
            body: JSON.stringify(prList),
        };
    } catch (error) {
        console.error("Error fetching pull requests:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch pull requests from GitHub.' }),
        };
    }
};