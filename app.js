const Discord = require('discord.js');
const client = new Discord.Client();
const config = require('./config.json');

// reference to current voice connection, only connected to one vc at a time
var currentConnection = null;

client.login(config.token);

client.on('ready', () => {
    console.log('Bot is online');
})

function destroySoundboard(guild)
{
    let channel = guild.channels.cache.find(channel => channel.name === 'soundboard');
    if (channel)
    {
        channel.delete();
    }
}

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
                    let newChannel = await message.guild.channels.create('soundboard', {
                        type: 'text',
                        topic: 'Interface for Soundboard',
                        parent: voiceChannel.parent,
                        // deny people to message soundboard channel
                        permissionOverwrites: [
                            {
                                id: message.guild.roles.everyone,
                                deny: ['SEND_MESSAGES']
                            }
                        ]
                    });
                    // send control panel message and add emoji reactions
                    let controls = await newChannel.send('Test');
                    message.guild.emojis.cache.each(emoji => {
                        controls.react(emoji);
                    })
                }
                else
                {
                    message.reply('You need to be in a voice channel for that to work...');
                }
            }
            else
            {
                message.reply("I'm already in a voice channel");
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
    }
});