const Discord = require('discord.js');
const client = new Discord.Client();
const config = require('./config.json');

const CATEGORY_NAME = 'soundboard';
const CHANNEL_NAME = 'soundboard-controls';

// reference to current voice connection, only connected to one vc at a time
var currentConnection = null;
// reference to soundboard-controls channel
var soundboardControl = null;

// bot setup state
// false is no setup is taking place
// true is an admin is assigning a reaction to a soundclip
var setupState = false;

client.login(config.token);

client.on('ready', () => {
    console.log('Bot is online');
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
}

client.on('messageReactionAdd', async (reaction, user) => {
    // only check user reactions on the soundboard control message
    if(user.id != config.user_id && soundboardControl && reaction.message.id === soundboardControl.id)
    {
        if(currentConnection)
        {
            // remove user's reactions
            reaction.users.remove(user);
            // play sound
            currentConnection.play(__dirname + '/audio/test.mp3');
        }
    }
    // messages reacted to during setup (setting up 1 soundclip)
    if (user.id != config.user_id && reaction.message.channel.name === 'soundboard-setup' && !setupState)
    {
        console.log('Setting up one soundclip');
        setupState = true;
        reaction.message.channel.send('You reacted with ' + reaction.emoji.toString());
        let soundclip = await reaction.message.channel.send('Which sound file should be played?');
        // do something to have the user select soundclip
        let collected = await soundclip.awaitReactions(() => true, {
            max: 1,
            maxEmojis: 1,
            maxUsers: 1
        });
        reaction.message.channel.send('Got it, assigning sound ' + collected.first().emoji + ' to the emoji reaction ' + reaction.emoji.toString());
        reaction.message.channel.send('What reaction should we setup next?');
        setupState = false;
    }
});

client.on('message', async message => {
    // messages sent to text channels
    if (message.guild){
        if (message.content === '.join') {
            if (!currentConnection)
            {
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
                            }
                        ]
                    });
                    // send control panel message and add emoji reactions
                    soundboardControl = await newChannel.send('Test');
                    message.guild.emojis.cache.each(emoji => {
                        soundboardControl.react(emoji);
                    });
                }
                else
                {
                    message.reply('You need to be in a voice channel for that to work...');
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
        else if (message.content === '.play' && currentConnection)
        {
            currentConnection.play(__dirname + '/audio/test.mp3');
        }
        else if (message.content === '.stop' && currentConnection)
        {
            currentConnection.dispatcher.end();
        }
        else if (message.content === '.die')
        {
            if(currentConnection)
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
        // test command for bot setup
        else if (message.content === '.setup')
        {
            // check if message was sent by server owner
            if (message.member.hasPermission(Discord.Permissions.FLAGS.ADMINISTRATOR))
            {
                // create setup channel
                try
                {
                    let channel = await message.guild.channels.create('soundboard-setup', {
                        type: 'text',
                        parent: message.parent,
                        position: message.position + 1,
                        permissionOverwrites: [
                            {
                                id: message.author,
                                allow: ['SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'VIEW_CHANNEL']
                            },
                            {
                                id: message.guild.roles.everyone,
                                deny: ['SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'VIEW_CHANNEL']
                            }
                        ]
                    });
                    channel.send('Hi there, welcome to the setup for Discord Soundboard\nReact to this message to start the setup procedure');
                    channel.send('Use .finish to finish the setup');
                }
                catch(e)
                {
                    console.log(e);
                }
            }
        }
        else if (message.content === '.finish')
        {
            if (message.member.hasPermission(Discord.Permissions.FLAGS.ADMINISTRATOR) && !setupState)
            {
                let setupChannel = message.guild.channels.cache.find(channel => channel.name === 'soundboard-setup');
                setupChannel.delete('Finished soundboard bot setup');
            }
        }
    }
});