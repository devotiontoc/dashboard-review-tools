import { neon } from '@netlify/neon';

const sql = neon();

export default async (req) => {
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const analysisData = await req.json();
        const { pr_number, tool_names, summary_charts } = analysisData;
        const timestamp = new Date().toISOString(); // This is the actual timestamp of the analysis

        // Iterate through each tool's data
        for (let i = 0; i < tool_names.length; i++) {
            const tool = tool_names[i];
            // Define a stable `id` based only on pr_number and tool_name
            // This ensures that 'ON CONFLICT' correctly identifies the row to update
            const stable_id = `${pr_number}-${tool}`;

            await sql`
                INSERT INTO analysis_history (id, pr_number, tool_name, timestamp, finding_count, novelty_score, findings_density)
                VALUES (
                           ${stable_id},
                           ${pr_number},
                           ${tool},
                           ${timestamp},
                           ${summary_charts.findings_by_tool[i]},
                           ${summary_charts.novelty_score[i]},
                           ${summary_charts.findings_density[i]}
                       )
                    ON CONFLICT (pr_number, tool_name) DO UPDATE SET
                                                              timestamp = EXCLUDED.timestamp,          -- Update the timestamp to the latest
                                                              finding_count = EXCLUDED.finding_count,  -- Update finding_count
                                                              novelty_score = EXCLUDED.novelty_score,  -- Update novelty_score
                                                              findings_density = EXCLUDED.findings_density -- Update findings_density
                                                          WHERE
                                                              analysis_history.timestamp < EXCLUDED.timestamp; -- Only update if the new data is newer
            `;
        }

        return new Response("Analysis saved successfully", { status: 200 });

    } catch (error) {
        console.error("Error saving analysis to Neon:", error);
        // Provide more detail in the error response for debugging
        return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
    }
};