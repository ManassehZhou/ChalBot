export interface CommandOption {
    type: number,
    name: string,
    description: string,
    required?: boolean,
}
export interface Command {
    name: string,
    description: string,
    options?: CommandOption[],
}
// ADD_CHAL_COMMAND
export const ADD_CHAL_COMMAND: Command = {
    name: "addchal",
    description: "Add a new challenge channel",
    options: [
        {
            type: 3, // Assuming string type is 3, adjust if different
            name: 'name',
            description: 'The name of the new challenge',
            required: true
        }
    ]
};
// SOLVED_COMMAND
export const SOLVED_COMMAND: Command = {
    name: "solved",
    description: "Mark a challenge as solved"
};
// UNSOLVED_COMMAND
export const UNSOLVED_COMMAND: Command = {
    name: "unsolved",
    description: "Mark a challenge as unsolved"
};
// RENAME_CHAL_COMMAND
export const RENAME_CHAL_COMMAND: Command = {
    name: "renamechal",
    description: "Rename a challenge channel",
    options: [
        {
            type: 3, // Assuming string type is 3, adjust if different
            name: 'newname',
            description: 'The new name for the channel',
            required: true
        }
    ]
};
// NEW_VOICE_CHANNEL_COMMAND
export const NEW_VOICE_CHANNEL_COMMAND: Command = {
    name: 'newvoicechannel',
    description: 'Add a new voice channel',
    options: [
        {
            type: 3, // Assuming string type is 3, adjust if different
            name: 'name',
            description: 'The name of the new voice channel',
            required: true
        }
    ]
};