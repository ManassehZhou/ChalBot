import { getRequestContext } from "@cloudflare/next-on-pages";
import { InteractionResponseFlags, verifyKey } from "discord-interactions";
import { ADD_CHAL_COMMAND, NEW_VOICE_CHANNEL_COMMAND, RENAME_CHAL_COMMAND, SOLVED_COMMAND, UNSOLVED_COMMAND } from "./commands";
import { APIApplicationCommandInteractionDataStringOption, APIChannel, APITextChannel, ChannelType, InteractionResponseType, InteractionType, MessageFlags, RESTPatchAPIChannelJSONBody, RESTPostAPIChannelMessageJSONBody, RESTPostAPIGuildChannelJSONBody } from "discord-api-types/v10";
import { MARKERS_TO_CHECK, MAX_CHANNEL_NAME_LENGTH, SOLVED_MARKER, UNSOLVED_MARKER } from "./const";

export const runtime = "edge";

// --- Helper to fetch channel details (remains the same) ---
async function getChannel(channelId: string, env: CloudflareEnv): Promise<APIChannel | null> {
    const url = `https://discord.com/api/v10/channels/${channelId}`;
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}`, 'User-Agent': 'MyDiscordBot' } });
        if (!response.ok) {
            console.error(`Error fetching channel ${channelId}: ${response.status}`, await response.text());
            return null;
        }
        return await response.json() as APIChannel;
    } catch (error) {
        console.error(`Network error fetching channel ${channelId}:`, error);
        return null;
    }
}

async function updateChannelName(channelId: string, newName: string, env: CloudflareEnv): Promise<boolean> {
    const url = `https://discord.com/api/v10/channels/${channelId}`;
    // Truncate name if it exceeds Discord's limit
    if (newName.length > MAX_CHANNEL_NAME_LENGTH) {
        console.warn(`New channel name exceeds limit (${newName.length} > ${MAX_CHANNEL_NAME_LENGTH}). Truncating.`);
        // Simple truncation, might need smarter logic depending on markers
        newName = newName.substring(0, MAX_CHANNEL_NAME_LENGTH);
    }

    const body: RESTPatchAPIChannelJSONBody = { name: newName };
    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bot ${env.DISCORD_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'MyDiscordBot',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error(`Error updating name for channel ${channelId} (${response.status}):`, errorData);
            // Check for specific error codes, e.g., missing permissions (50013)
            // if (errorData.code === 50013) { /* Handle missing perms */ }
            return false;
        }
        console.log(`Successfully updated name for channel ${channelId} to "${newName}"`);
        return true;
    } catch (error) {
        console.error(`Network error updating name for channel ${channelId}:`, error);
        return false;
    }
}

function cleanChannelName(currentName: string): string {
    let cleanedName = currentName;
    for (const marker of MARKERS_TO_CHECK) {
        if (cleanedName.startsWith(marker)) {
            cleanedName = cleanedName.substring(marker.length);
            break; // Assume only one marker exists at the beginning
        }
    }
    return cleanedName;
}


export async function POST(request: Request) {
    const { env, cf, ctx } = getRequestContext();

    const { isValid, interaction } = await verifyDiscordRequest(
        request,
        env,
    );
    if (!isValid || !interaction) {
        return new Response('Bad request signature.', { status: 401 });
    }

    if (interaction.type === InteractionType.Ping) {
        // The `PING` message is used during the initial webhook handshake, and is
        // required to configure the webhook in the developer portal.
        return Response.json({
            type: InteractionResponseType.Pong,
        });
    }

    const { name: commandName } = interaction.data;
    const guildId = interaction.guild_id;
    const channelId = interaction.channel_id;

    if (!guildId) {
        // Should generally not happen for guild commands, but good practice
        return Response.json({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: { content: 'Command not available here.', flags: MessageFlags.Ephemeral },
        });
    }

    if (interaction.type === InteractionType.ApplicationCommand) {
        // Most user commands will come as `APPLICATION_COMMAND`.
        switch (interaction.data.name.toLowerCase()) {
            case ADD_CHAL_COMMAND.name.toLowerCase():
                {
                    const nameOption = interaction.data.options?.find(
                        (opt: { name: string; type: number; }): opt is APIApplicationCommandInteractionDataStringOption => // Type guard
                            opt.name === 'name' && opt.type === 3 // 3 = STRING
                    );

                    const channelName = nameOption?.value.replace(' ', '-').toLowerCase().trim();

                    if (!channelName) {
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                content: 'Error: name is required when performing addchal',
                                flags: MessageFlags.Ephemeral
                            },
                        })
                    }
                    const discordApiUrl = `https://discord.com/api/v10/guilds/${guildId}/channels`;
                    const body: RESTPostAPIGuildChannelJSONBody = {
                        name: UNSOLVED_MARKER + channelName,
                        type: ChannelType.GuildText, // 使用枚举更清晰
                        parent_id: interaction.channel.parent_id
                    };

                    try {
                        const response = await fetch(discordApiUrl, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bot ${env.DISCORD_TOKEN}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(body),
                        });

                        if (!response.ok) {
                            const errorData = await response.json();
                            console.error(`Discord API Error (${response.status}):`, errorData);
                            return Response.json({
                                type: InteractionResponseType.ChannelMessageWithSource,
                                data: {
                                    content: `create channel error (${response.status}): ${JSON.stringify(errorData)}`,
                                    flags: MessageFlags.Ephemeral,
                                },
                            });
                        }

                        // Discord 返回创建的频道对象
                        const newChannel = await response.json() as APITextChannel; // 断言响应类型
                        console.log(`Successfully created channel: ${newChannel.name} (${newChannel.id})`);

                        // c. 回复用户
                        const responseBody: RESTPostAPIChannelMessageJSONBody = {
                            content: `✅ New Challenge Found!!! \n<#${newChannel.id}>`,
                        }
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: responseBody,
                        });

                    } catch (apiError) {
                        console.error('Error calling Discord API:', apiError);
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                content: 'create channel internal error',
                                flags: MessageFlags.Ephemeral,
                            },
                        });
                    }
                }
            case SOLVED_COMMAND.name.toLowerCase():
                {
                    // 1. Fetch current channel details
                    const channel = await getChannel(channelId, env);
                    if (!channel) {
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                content: '❌ 无法获取当前频道信息。',
                                flags: MessageFlags.Ephemeral
                            }
                        });
                    }

                    // 2. Ensure it's a text channel (or other type you want to support)
                    if (channel.type !== ChannelType.GuildText /* && other supported types */) {
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource, data: {
                                content: 'ℹ️ 此命令只能在文本频道中使用。',
                                flags: MessageFlags.Ephemeral
                            }
                        });
                    }

                    const currentName = channel.name || 'channel'; // Fallback name

                    // 3. Check if already marked as solved
                    if (currentName.startsWith(SOLVED_MARKER)) {
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource, data: {
                                content: 'ℹ️ 此频道已标记为已解决。',
                                flags: MessageFlags.Ephemeral
                            }
                        });
                    }

                    // 4. Prepare new name (remove old markers first)
                    const baseName = cleanChannelName(currentName);
                    const newName = SOLVED_MARKER + baseName;

                    // 5. Update channel name via API
                    const success = await updateChannelName(channelId, newName, env);

                    // 6. Respond to user
                    if (success) {
                        return Response.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: `✅ 已将频道标记为已解决。` } });
                    } else {
                        return Response.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: '❌ 更新频道名称时出错，请检查机器人是否有 `Manage Channels` 权限或稍后再试。', flags: MessageFlags.Ephemeral } });
                    }
                }

            case UNSOLVED_COMMAND.name.toLowerCase():
                {
                    // 1. Fetch current channel details
                    const channel = await getChannel(channelId, env);
                    if (!channel) {
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                content: '❌ 无法获取当前频道信息。',
                                flags: MessageFlags.Ephemeral
                            }
                        });
                    }

                    // 2. Ensure it's a text channel (or other type you want to support)
                    if (channel.type !== ChannelType.GuildText /* && other supported types */) {
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource, data: {
                                content: 'ℹ️ 此命令只能在文本频道中使用。',
                                flags: MessageFlags.Ephemeral
                            }
                        });
                    }

                    const currentName = channel.name || 'channel'; // Fallback name

                    // 3. Check if already marked as solved
                    if (currentName.startsWith(UNSOLVED_MARKER)) {
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource, data: {
                                content: 'ℹ️ 此频道已标记为未解决。',
                                flags: MessageFlags.Ephemeral
                            }
                        });
                    }

                    // 4. Prepare new name (remove old markers first)
                    const baseName = cleanChannelName(currentName);
                    const newName = UNSOLVED_MARKER + baseName;

                    // 5. Update channel name via API
                    const success = await updateChannelName(channelId, newName, env);

                    // 6. Respond to user
                    if (success) {
                        return Response.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: `✅ 已将频道标记为未解决。` } });
                    } else {
                        return Response.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: '❌ 更新频道名称时出错，请检查机器人是否有 `Manage Channels` 权限或稍后再试。', flags: MessageFlags.Ephemeral } });
                    }
                }

            case RENAME_CHAL_COMMAND.name.toLowerCase():
                {
                    const newNameOption = interaction.data.options?.find(
                        (opt: { name: string; type: number; }): opt is APIApplicationCommandInteractionDataStringOption => // Type guard
                         opt.name === 'newname' && opt.type === 3 // STRING
                     );
                     const desiredBaseName = newNameOption?.value.replace(' ', '-').toLowerCase().trim(); // Get value and trim whitespace
        
                     if (!desiredBaseName) {
                         console.error('Missing or empty "newname" option for renamechal command');
                         return Response.json({
                             type: InteractionResponseType.ChannelMessageWithSource,
                             data: { content: '❌ 请提供有效的频道新名称。', flags: MessageFlags.Ephemeral },
                         });
                     }
        
                     // 2. Fetch current channel details to check for existing markers
                    const channel = await getChannel(channelId, env);
                    if (!channel) {
                         return Response.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: '❌ 无法获取当前频道信息。', flags: MessageFlags.Ephemeral } });
                    }
        
                    // 3. Ensure it's a type we can rename (usually text, maybe others)
                    if (channel.type !== ChannelType.GuildText /* && other supported types */) {
                         return Response.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: 'ℹ️ 此命令只能用于文本频道。', flags: MessageFlags.Ephemeral } });
                    }
        
                    const currentName = channel.name || 'channel';
                    let prefixMarker = '';
        
                    // 4. Check if current name has a known marker to preserve it
                    for (const marker of MARKERS_TO_CHECK) {
                        if (currentName.startsWith(marker)) {
                            prefixMarker = marker;
                            break;
                        }
                    }
        
                    // 5. Construct the final new name
                    const finalNewName = prefixMarker + desiredBaseName;
        
                     // Optional: Check if the name is actually changing
                     if (finalNewName === currentName) {
                         return Response.json({
                             type: InteractionResponseType.ChannelMessageWithSource,
                             data: { content: `ℹ️ 频道名称已经是 \`${desiredBaseName}\`${prefixMarker ? ' (带有标记)' : ''}。`, flags: MessageFlags.Ephemeral },
                         });
                     }
        
                     // Check length *after* adding marker (helper also checks, but good to pre-check)
                     if (finalNewName.length > MAX_CHANNEL_NAME_LENGTH) {
                         return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: { content: `❌ 抱歉，新的频道名称（包括标记 "${prefixMarker}"）过长（${finalNewName.length}/${MAX_CHANNEL_NAME_LENGTH} 字符）。请缩短名称。`, flags: MessageFlags.Ephemeral },
                         });
                     }
        
        
                    // 6. Update channel name via API
                    const success = await updateChannelName(channelId, finalNewName,env);
        
                    // 7. Respond to user
                    if (success) {
                        // Mentioning the channel <#channelId> makes it clickable
                        return Response.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: `✅ 频道 <#${channelId}> 已成功重命名为 \`${desiredBaseName}\`${prefixMarker ? ' (保留了标记)' : ''}。` } });
                    } else {
                         // The helper function logs detailed errors, provide a generic one to the user.
                         return Response.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: '❌ 重命名频道时出错，请检查机器人是否有 `Manage Channels` 权限或稍后再试。', flags: MessageFlags.Ephemeral } });
                    }        
                }

            case NEW_VOICE_CHANNEL_COMMAND.name.toLowerCase():
                {
                    const nameOption = interaction.data.options?.find(
                        (opt: { name: string; type: number; }): opt is APIApplicationCommandInteractionDataStringOption => // Type guard
                            opt.name === 'name' && opt.type === 3 // 3 = STRING
                    );

                    const channelName = nameOption?.value.replace(' ', '-').toLowerCase().trim()

                    if (!channelName) {
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                content: 'Error: name is required when performing addchal',
                                flags: MessageFlags.Ephemeral
                            },
                        })
                    }
                    const discordApiUrl = `https://discord.com/api/v10/guilds/${guildId}/channels`;
                    const body: RESTPostAPIGuildChannelJSONBody = {
                        name: channelName,
                        type: ChannelType.GuildVoice, // 使用枚举更清晰
                        parent_id: interaction.channel.parent_id
                    };

                    try {
                        const response = await fetch(discordApiUrl, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bot ${env.DISCORD_TOKEN}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(body),
                        });

                        if (!response.ok) {
                            const errorData = await response.json();
                            console.error(`Discord API Error (${response.status}):`, errorData);
                            return Response.json({
                                type: InteractionResponseType.ChannelMessageWithSource,
                                data: {
                                    content: `create channel error (${response.status}): ${JSON.stringify(errorData)}`,
                                    flags: MessageFlags.Ephemeral,
                                },
                            });
                        }

                        // Discord 返回创建的频道对象
                        const newChannel = await response.json() as APITextChannel; // 断言响应类型
                        console.log(`Successfully created channel: ${newChannel.name} (${newChannel.id})`);

                        // c. 回复用户
                        const responseBody: RESTPostAPIChannelMessageJSONBody = {
                            content: `✅ New Voice Channel Found!!! \n<#${newChannel.id}>`,
                        }
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: responseBody,
                        });

                    } catch (apiError) {
                        console.error('Error calling Discord API:', apiError);
                        return Response.json({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                content: 'create channel internal error',
                                flags: MessageFlags.Ephemeral,
                            },
                        });
                    }
                }
            default:
                return Response.json({ error: 'Unknown Type' }, { status: 400 });
        }
    }

    return Response.json({ error: 'Unknown Type' }, { status: 400 });
}

export async function GET(request: Request): Promise<Response> {
    const { env, cf, ctx } = getRequestContext();
    return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`)
}

async function verifyDiscordRequest(request: Request, env: CloudflareEnv) {
    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const body = await request.text();
    const isValidRequest =
        signature &&
        timestamp &&
        (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
    if (!isValidRequest) {
        return { isValid: false };
    }

    return { interaction: JSON.parse(body), isValid: true };
}