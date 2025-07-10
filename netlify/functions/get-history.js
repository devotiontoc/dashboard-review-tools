import { neon } from '@netlify/neon';

const sql = neon(); // Automatically uses the NETLIFY_DATABASE_URL

export default async () => {
    try {
        // Query the database and order by timestamp descending
        const historyData = await sql`
            SELECT * FROM analysis_history 
            ORDER BY timestamp DESC
        `;

        return Response.json(historyData);

    } catch (error) {
        console.error("Error fetching history from Neon:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};