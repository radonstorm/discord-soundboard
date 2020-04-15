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
// reference to soundboard-controls channel
var soundboardControl = null;
// reference to currently active setup message
var setupMessage = null;

// list of soundfiles found in AUDIO_DIR. populated during setup and destroyed after
var soundFiles = null;
// list of selection emoji used during setup
var selectionEmoji = null;

// map of emoji to sound filenames
var sounds = new Map();

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
    }
});

client.login(config.token);

client.on('ready', () => {
    emojiBindings.sync();
    servers.sync();
});

function destroySoundboard(guild)
{
    let channel = guild.channels.cache.find(channel => channel.name === CHANNEL_NAME);
    if (channel)
    {
        channel.delete();
    }
    let category = guild.channels.cache.find(category => category.name === CATEGORY_NAME);
    if (category)
    {
        category.delete();
    }
    soundboardControl = null;
    sounds = new Map();
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
            setupMessage = await channel.send('Hi there, welcome to the setup for Discord Soundboard\nReact to this message to start the setup procedure');
            channel.send('Use .finish to finish the setup');
            await servers.create({
                server_id: guild.id
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
    if(user.id != config.user_id && soundboardControl && reaction.message.id === soundboardControl.id)
    {
        if(currentConnection)
        {
            // remove user's reactions
            reaction.users.remove(user);
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
            let binding = emojiBindings.create({
                emoji_id: reaction.emoji.id,
                soundclip: selectedSound,
                server_id: reaction.message.guild.id
            });
            console.log('Added ' + binding + ' to db');
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
        if (message.content === '.join') {
            // if not currently connected to a voice channel
            if (!currentConnection)
            {
                // if server is recorded in database we're good to go
                const server = await servers.findOne({ where: { server_id: message.guild.id }});
                if(server)
                {
                    // load from database
                    const loadedBindings = await emojiBindings.findAll({ 
                        attributes: ['emoji_id', 'soundclip'],
                        where: { server_id: message.guild.id }
                    });
                    for(let binding of loadedBindings)
                    {
                        sounds.set(binding.emoji_id, binding.soundclip);
                    }

                    // Try to join the sender's voice channel
                    if (message.member.voice.channel) {
                        let voiceChannel = message.member.voice.channel;
                        let connection = await voiceChannel.join();
                        currentConnection = connection;
                        console.log('Joined #' + connection.channel.name);
                        
                        // create soundboard interface
                        // create category first
                        let newCategory = await message.guild.channels.create(CATEGORY_NAME, {
                            type: 'category',
                            position: voiceChannel.parent.position + 1
                        });
                        
                        // create channel
                        let newChannel = await message.guild.channels.create(CHANNEL_NAME, {
                            type: 'text',
                            topic: 'Interface for Soundboard',
                            parent: newCategory,
                            // deny people to message soundboard channel
                            permissionOverwrites: [
                                {
                                    id: message.guild.roles.everyone,
                                    deny: ['SEND_MESSAGES']
                                },
                                {
                                    id: message.guild.me.id,
                                    allow: ['SEND_MESSAGES']
                                }
                            ]
                        });
                        // send control panel message and add emoji reactions
                        let controlMessage = '';
                        for (let key of sounds.keys())
                        {
                            let emoji = message.guild.emojis.resolve(key);
                            controlMessage = controlMessage + emoji.toString() + ' - ' + sounds.get(key) + '\n';
                        }
                        soundboardControl = await newChannel.send(controlMessage);
                        for (let key of sounds.keys())
                        {
                            soundboardControl.react(key);
                        }
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
                destroySoundboard(message.guild);
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
                client.guilds.cache.each(guild =>
                {
                    destroySoundboard(guild);
                });
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
        else if (message.content === '.finish')
        {
            if (message.member.hasPermission(Discord.Permissions.FLAGS.ADMINISTRATOR))
            {
                let setupChannel = message.guild.channels.cache.find(channel => channel.name === SETUP_NAME);
                setupChannel.delete('Finished soundboard bot setup');
                soundFiles = null;
                selectionEmoji = null;
                setupMessage = null;
            }
        }
    }
});