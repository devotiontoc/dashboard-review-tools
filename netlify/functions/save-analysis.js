// netlify/functions/save-analysis.js

import { neon } from '@netlify/neon';

const sql = neon();

export default async (req) => {
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const analysisData = await req.json();
        const { metadata, summary_charts } = analysisData;
        const { pr_number, tool_names } = metadata;
        const timestamp = new Date().toISOString();

        await sql.transaction(async (tx) => {
            for (let i = 0; i < tool_names.length; i++) {
                const tool = tool_names[i];
                const record_id = `${pr_number}-${tool}`;
                const finding_count = summary_charts.findings_by_tool[i] || 0;
                const novelty_score = summary_charts.novelty_score[i] || 0;
                const findings_density = summary_charts.findings_density[i] || 0;

                await tx`
                    INSERT INTO analysis_history (id, pr_number, tool_name, timestamp, finding_count, novelty_score, findings_density)
                    VALUES (${record_id}, ${pr_number}, ${tool}, ${timestamp}, ${finding_count}, ${novelty_score}, ${findings_density})
                        ON CONFLICT ON CONSTRAINT unique_pr_tool DO UPDATE SET
                                                                        timestamp = EXCLUDED.timestamp,
                                                                        finding_count = EXCLUDED.finding_count,
                                                                        novelty_score = EXCLUDED.novelty_score,
                                                                        findings_density = EXCLUDED.findings_density;
                `;
            }
        });

        return new Response("Analysis saved successfully", { status: 200 });

    } catch (error) {
        console.error("Error saving analysis to Neon:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};