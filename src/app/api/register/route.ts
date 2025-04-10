
import { getRequestContext } from "@cloudflare/next-on-pages";
import { ADD_CHAL_COMMAND, NEW_VOICE_CHANNEL_COMMAND, RENAME_CHAL_COMMAND, SOLVED_COMMAND, UNSOLVED_COMMAND } from "../commands";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
    const { env, cf, ctx } = getRequestContext();

    const url = `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`;

    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${env.DISCORD_TOKEN}`,
        },
        method: "PUT",
        body: JSON.stringify([
            ADD_CHAL_COMMAND,
            SOLVED_COMMAND,
            UNSOLVED_COMMAND,
            RENAME_CHAL_COMMAND,
            NEW_VOICE_CHANNEL_COMMAND,
        ])
    })

    if (response.ok) {
        console.log('Registered all commands');
        const data = await response.json();
        return Response.json(data)
    } else {
        console.error('Error registering commands');
        let errorText = `Error registering commands \n ${response.url}: ${response.status} ${response.statusText}`;
        try {
            const error = await response.text();
            if (error) {
                errorText = `${errorText} \n\n ${error}`;
            }
            return new Response(errorText, {
                status: 400
            })
        } catch (err) {
            console.error('Error reading body from request:', err);
        }
        console.error(errorText);
    }

    return Response.error()
}