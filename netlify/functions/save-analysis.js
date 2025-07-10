import { neon } from '@netlify/neon';

const sql = neon();

export default async (req) => {
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const analysisData = await req.json();
        const { pr_number, tool_names, summary_charts } = analysisData;
        const timestamp = new Date().toISOString();

        // Create an INSERT query for each tool's analysis
        for (let i = 0; i < tool_names.length; i++) {
            const tool = tool_names[i];
            const record_id = `${pr_number}-${tool}-${timestamp}`;

            await sql`
                INSERT INTO analysis_history (id, pr_number, tool_name, timestamp, finding_count, novelty_score, findings_density)
                VALUES (
                    ${record_id},
                    ${pr_number},
                    ${tool},
                    ${timestamp},
                    ${summary_charts.findings_by_tool[i]},
                    ${summary_charts.novelty_score[i]},
                    ${summary_charts.findings_density[i]}
                )
            `;
        }

        return new Response("Analysis saved successfully", { status: 200 });

    } catch (error) {
        console.error("Error saving analysis to Neon:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};