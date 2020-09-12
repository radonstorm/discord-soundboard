const Discord = require('discord.js');
const client = new Discord.Client();
const config = require('./config.json');
const Sequelize = require('sequelize');
const fs = require('fs');

const CATEGORY_NAME = 'soundboard';
const CHANNEL_NAME = 'soundboard-controls';
const SETUP_NAME = 'soundboard-setup';
const AUDIO_DIR = __dirname + '/audio/';

// reference to current voice connection, only connected to one vc at a time
var currentConnection = null;
// reference to all soundboard controls messages
var soundboardControls = new Set();
// reference to all soundboard-control channels
var soundboardControlChannels = new Set();
// reference to currently active setup message
var setupMessage = null;

// list of soundfiles found in AUDIO_DIR. populated during setup and destroyed after
var soundFiles = null;
// list of selection emoji used during setup
var selectionEmoji = null;

// map of emoji to sound filenames
var sounds = new Map();

// collection of event handlers
client.events = new Discord.Collection();
const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    const command = require(`./events/${file}`);
    client.events.set(command.name, command)
}

// database connection
const database = new Sequelize('database', 'user', 'password', {
    host: 'localhost',
    dialect: 'sqlite',
    logging: false,
    storage: 'botsettings.sqlite'
});
// define db model
const emojiBindings = database.define('emojibindings', {
    emoji_id: {
        type: Sequelize.STRING,
        unique: true
    },
    soundclip: Sequelize.STRING,
    server_id: {
        type: Sequelize.STRING,
        references: {
            model: 'servers',
            key: 'server_id'
        }
    }
});

const servers = database.define('servers', {
    server_id: {
        type: Sequelize.STRING,
        unique: true
    },
    control_message_id: Sequelize.STRING,
    control_channel_id: Sequelize.STRING
});

client.login(config.token);

client.on('ready', async () => {
    console.log('Soundboard online');
    emojiBindings.sync();
    servers.sync();
    // load control message ids
    let servers_db = await servers.findAll({
        attributes: ['server_id', 'control_message_id', 'control_channel_id']
    });
    for(let server of servers_db)
    {
        // guild object representing current server
        let guild = client.guilds.resolve(server.server_id);
        let controlMessageID = server.control_message_id;
        let controlChannelID = server.control_channel_id;
        // if control channel is not recorded in db, (using old version)
        // OR if the channel doesnt exist (deleted between outages)
        // create channels and send message
        if (!controlChannelID ||!guild.channels.resolve(controlChannelID))
        {
            let createdChannels = await createControlChannel(guild);
            await servers.update({
                control_channel_id: createdChannels.channel.id,
                control_message_id: createdChannels.message.id
            }, {
                where: {
                    server_id: server.server_id
                }
            });
            controlMessageID = createdChannels.message.id;
            controlChannelID = createdChannels.channel.id;
        }
        // add message id to set
        soundboardControls.add(controlMessageID);
        soundboardControlChannels.add(controlChannelID);
        // add control message to cache so we can catch messageReactionAdd events
        guild.channels.resolve(controlChannelID).messages.fetch(controlMessageID);
    }
});

// given a server id load appropriate bindings from the db
async function loadBindings(serverId)
{
    return emojiBindings.findAll({
        attributes: ['emoji_id', 'soundclip'],
        where: { server_id: serverId }
    });
}

// create control channel and send message
async function createControlChannel(guild)
{
    let category = await guild.channels.create(CATEGORY_NAME,{
        type: 'category'
    });
    let channel = await guild.channels.create(CHANNEL_NAME, {
        type: 'text',
        topic: 'Interface for Soundboard',
        parent: category,
        // deny messages
        permissionOverwrites: [
            {
                id: guild.roles.everyone,
                deny: ['SEND_MESSAGES']
            },
            {
                id: guild.me.id,
                allow: ['SEND_MESSAGES']
            }
        ]
    });
    let bindings = await loadBindings(guild.id);
    let message = '';
    for (let binding of bindings)
    {
        let emoji = guild.emojis.resolve(binding.emoji_id);
        message = message + emoji.toString() + ' - ' + binding.soundclip.split('.')[0] + '\n';
    }
    let soundboardControlMessage = await channel.send(message);
    for (let binding of bindings)
    {
        soundboardControlMessage.react(binding.emoji_id);
    }
    return {
        channel: channel,
        category: category,
        message: soundboardControlMessage
    };
}
// bot joined a guild, add id to db and prompt setup
client.on('guildCreate', async guild => {
    try
    {
        const server = await servers.findOne({ where: { server_id: guild.id }});
        if (!server)
        {
            // populate file list
            soundFiles = fs.readdirSync(AUDIO_DIR);
            // populate selection emoji list
            selectionEmoji = Array.from(guild.emojis.cache.values());
            console.log(guild.roles.highest.name);
            let channel = await guild.channels.create(SETUP_NAME, {
                type: 'text',
                topic: 'Setup channel for Soundboard',
                permissionOverwrites: [
                    {
                        id: guild.roles.highest.id,
                        allow: ['SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'VIEW_CHANNEL']
                    },
                    {
                        id: guild.roles.everyone,
                        deny: ['SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'VIEW_CHANNEL']
                    },
                    {
                        id: guild.me.id,
                        allow: ['SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'VIEW_CHANNEL']
                    }
                ]
            });
            setupMessage = await channel.send('Hi there, welcome to the setup for Discord Soundboard\nReact to this message to start the setup procedure\nUse .finish to finish the setup');
            await servers.create({
                server_id: guild.id,
                control_message_id: null,
                control_channel_id: null
            });
        }
    }
    catch (e)
    {
        if (e.name === 'SequelizeUniqueConstraintError')
        {
            console.log('Server already exists in database');
        }
        else
        {
            console.log(e);
        }
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    // only check user reactions on the soundboard control message
    if(user.id != config.user_id && soundboardControls.has(reaction.message.id))
    {
        // remove user's reactions
        reaction.users.remove(user);
        if(currentConnection)
        {
            // play sound
            console.log('Playing ' + sounds.get(reaction.emoji.id));
            currentConnection.play(AUDIO_DIR + sounds.get(reaction.emoji.id));
        }
    }
    // messages reacted to during setup (setting up 1 soundclip)
    if (user.id != config.user_id && reaction.message.channel.name === SETUP_NAME && reaction.message.id == setupMessage.id)
    {
        console.log('Setting up one soundclip');
        reaction.message.channel.send('You reacted with ' + reaction.emoji.toString());
        // do something to have the user select soundclip
        // send message of audio files
        let message = '';
        let limit = soundFiles.length;
        if (limit > selectionEmoji.length)
        {
            limit = selectionEmoji.length;
        }
        for (let ii = 0; ii < limit; ii++)
        {
            message = message + selectionEmoji[ii].toString() + ' - ' + soundFiles[ii] + '\n';
        }
        message = message + 'Which sound file should be played?';
        let selectionMessage = await reaction.message.channel.send(message);
        // selectionEmoji.forEach(async (emoji) => {
        //     await selectionMessage.react(emoji);
        // });
        let collected = await selectionMessage.awaitReactions((reaction, user) => user.id != config.user_id, {
            max: 1,
            maxEmojis: 1,
            maxUsers: 1
        });
        let selectedSound = soundFiles[selectionEmoji.indexOf(collected.first().emoji)];
        reaction.message.channel.send('Got it, assigning sound ' + selectedSound + ' to the emoji reaction ' + reaction.emoji.toString());
        // add sound to db
        try
        {
            let binding = await emojiBindings.findOne({ where: { emoji_id: reaction.emoji.id }});
            if (binding)
            {
                await emojiBindings.update({ soundclip: selectedSound }, { where: { emoji_id: reaction.emoji.id }});
                console.log('Updated binding for ' + reaction.emoji.toString());
            }
            else
            {
                binding = await emojiBindings.create({
                    emoji_id: reaction.emoji.id,
                    soundclip: selectedSound,
                    server_id: reaction.message.guild.id
                });
                console.log('Added ' + binding + ' to db');
            }
        }
        catch(e)
        {
            console.log(e);
        }
        // remove emoji and soundfile from arrays
        soundFiles.splice(soundFiles.indexOf(selectedSound), 1);
        selectionEmoji.splice(selectionEmoji.indexOf(collected.first().emoji), 1);
        setupMessage = await reaction.message.channel.send('React again to this message to setup another sound or type ".finish" to end setup');
    }
});

client.on('message', async message => {
    // messages sent to text channels
    if (message.guild){
        if (soundboardControlChannels.has(message.channel.id))
        {
            message.delete();
        }
        else if (message.content === '.join') {
            // if not currently connected to a voice channel
            if (!currentConnection)
            {
                // if server is recorded in database we're good to go
                const server = await servers.findOne({ where: { server_id: message.guild.id }});
                if(server)
                {
                    // check if the channel exists, if not recreate
                    if (!message.guild.channels.cache.get(server.control_channel_id))
                    {
                        soundboardControls.delete(server.control_message_id);
                        soundboardControlChannels.delete(server.control_channel_id);
                        let createdChannels = await createControlChannel(message.guild);
                        await servers.update({
                            control_channel_id: createdChannels.channel.id,
                            control_message_id: createdChannels.message.id
                        }, {
                            where: {
                                server_id: message.guild.id
                            }
                        });
                        soundboardControls.add(createdChannels.message.id);
                        soundboardControlChannels.add(createdChannels.channel.id);
                    }
                    let bindings = await loadBindings(message.guild.id);
                    for(let binding of bindings)
                    {
                        sounds.set(binding.emoji_id, binding.soundclip);
                    }
                    // Try to join the sender's voice channel
                    if (message.member.voice.channel) {
                        let voiceChannel = message.member.voice.channel;
                        let connection = await voiceChannel.join();
                        currentConnection = connection;
                        console.log('Joined #' + connection.channel.name);
                    }
                    else
                    {
                        message.reply('You need to be in a voice channel for that to work...');
                    }
                }
                else
                {
                    message.reply('I\'m not set up yet!');
                }
            }
            else
            {
                message.reply('I\'m already in a voice channel');
            }
        }
        else if (message.content === '.dc')
        {
            if (currentConnection)
            {
                let name = currentConnection.channel.name;
                currentConnection.disconnect();
                currentConnection = null;
                console.log('Disconnected from #' + name);
                sounds = new Map();
            }
            else
            {
                message.reply('Not currently in a voice channel');
            }
        }
        else if (message.content === '.stop' && currentConnection)
        {
            currentConnection.dispatcher.end();
        }
        else if (message.content === '.die')
        {
            if (message.member.id === config.owner_id)
            {
                if (currentConnection)
                {
                    currentConnection.disconnect();
                    currentConnection = null;
                }
                client.destroy();
            }
        }
        // test command for bot setup
        else if (message.content === '.setup')
        {
            if (!currentConnection)
            {
                // check if message was sent by server owner
                if (message.member.hasPermission(Discord.Permissions.FLAGS.ADMINISTRATOR))
                {
                    // create setup channel
                    try
                    {
                        // check if server is recorded in db, if not then add it
                        //only really used for dev
                        if (!await servers.findOne({ where: { server_id: message.guild.id }}))
                        {
                            await servers.create({
                                server_id: message.guild.id,
                                control_message_id: null,
                                control_channel_id: null
                            });
                        }
                        // populate file list
                        soundFiles = fs.readdirSync(AUDIO_DIR);
                        // populate selection emoji list
                        selectionEmoji = Array.from(message.guild.emojis.cache.values());
                        let channel = await message.guild.channels.create(SETUP_NAME, {
                            type: 'text',
                            topic: 'Setup channel for Soundboard',
                            parent: message.parent,
                            position: message.position + 1,
                            permissionOverwrites: [
                                {
                                    id: message.guild.roles.highest.id,
                                    allow: ['SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'VIEW_CHANNEL']
                                },
                                {
                                    id: message.guild.roles.everyone,
                                    deny: ['SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'VIEW_CHANNEL']
                                },
                                {
                                    id: message.guild.me.id,
                                    allow: ['SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'VIEW_CHANNEL']
                                }
                            ]
                        });
                        setupMessage = await channel.send('Hi there, welcome to the setup for Discord Soundboard\nReact to this message to start the setup procedure\nUse .finish to finish the setup');
                    }
                    catch(e)
                    {
                        console.log(e);
                    }
                }
            }
            else
            {
                message.reply('I can\'t be set up if I\'m in a voice channel');
            }
        }
        // finish setup, create control channel & message
        else if (message.content === '.finish')
        {
            if (message.member.hasPermission(Discord.Permissions.FLAGS.ADMINISTRATOR))
            {
                let setupChannel = message.guild.channels.cache.find(channel => channel.name === SETUP_NAME);
                setupChannel.delete('Finished soundboard bot setup');
                soundFiles = null;
                selectionEmoji = null;
                setupMessage = null;

                // check if there is already a control channel and message
                let server = await servers.findOne({ where: { server_id: message.guild.id }});
                if (server.control_channel_id && message.guild.channels.cache.get(server.control_channel_id))
                {
                    console.log('Updating control message');
                    // edit current control message
                    let controlChannel = message.guild.channels.cache.get(server.control_channel_id);
                    let controlMessage = controlChannel.messages.cache.get(server.control_message_id);
                    let bindings = await loadBindings(message.guild.id);
                    let text = '';
                    for (let binding of bindings)
                    {
                        let emoji = message.guild.emojis.resolve(binding.emoji_id);
                        text = text + emoji.toString() + ' - ' + binding.soundclip.split('.')[0] + '\n';
                    }
                    controlMessage.edit(text);
                    // re send reactions to reflect changes
                    controlMessage.reactions.removeAll();
                    for (let binding of bindings)
                    {
                        controlMessage.react(binding.emoji_id);
                    }
                }
                else
                {
                    // create control channels, update db with channel ids
                    console.log('Creating controls');
                    let createdChannels = await createControlChannel(message.guild);                
                    await servers.update({
                        control_channel_id: createdChannels.channel.id,
                        control_message_id: createdChannels.message.id
                    }, {
                        where: {
                            server_id: message.guild.id
                        }
                    });
                    soundboardControls.add(createdChannels.message.id);
                    soundboardControlChannels.add(createdChannels.channel.id);
                }
            }
        }
        else if (message.content.startsWith('.dl'))
        {
            client.events.get('youtube-dl').execute(message, {AUDIO_DIR: AUDIO_DIR});
        }
        else if (message.content === '.source')
        {
            message.channel.send('https://github.com/radonstorm/discord-soundboard');
        }
    }
});