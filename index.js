const Discord = require('discord.js');
const client = new Discord.Client();
const properties = require('properties')

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
            // Try to join the sender's voice channel
            if (message.member.voice.channel) {
                const connection = await message.member.voice.channel.join()
                console.log('Joined #' + connection.channel.name);
            }
            else
            {
                message.reply('You need to be in a voice channel for that to work...');
            }
        }
    }
});