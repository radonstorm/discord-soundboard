const Discord = require('discord.js');
const client = new Discord.Client();
const properties = require('properties');

// reference to current voice connection, only connected to one vc at a time
var currentConnection = null;

// read token from a config.ini file and login
properties.parse('config.ini', { path: true }, function(error, obj){
    if(error)
    {
        console.error(error);
    }
    client.login(obj.token)
})

client.on('ready', () => {
    console.log('Bot is online');
})

client.on('message', async message => {
    // messages sent to text channels
    if (message.guild){
        if (message.content === '.join') {
            if (!currentConnection)
            {
                // Try to join the sender's voice channel
                if (message.member.voiceChannel) {
                    message.member.voiceChannel.join()
                        .then(connection => {
                            currentConnection = connection;
                            console.log('Joined #' + connection.channel.name);
                        })
                        .catch(console.log);
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
            }
            else
            {
                message.reply('Not currently in a voice channel');
            }
        }
        else if (message.content === '.play' && currentConnection)
        {
            currentConnection.playFile(__dirname + '/audio/test.mp3');
        }
        else if (message.content === '.stop' && currentConnection)
        {
            currentConnection.dispatcher.end();
        }
    }
});