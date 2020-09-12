const ytdl = require('ytdl-core');
const fs = require('fs');
const download = async function(message, args)
{
    // only parse valid youtube and shortened youtu.be links
    if (message.content.includes('youtube.com') || message.content.includes('youtu.be'))
    {
        // split url from user given command
        const url = message.content.split(' ')[1];
        let info = await ytdl.getInfo(url, {quality: 'highestaudio', filter: 'audio'});
        // only download videos 30 seconds or under
        if (Number(info.length_seconds) <= 30)
        {
            console.log('Downloading YouTube video ' + info.title + ': ' + info.video_id);
            ytdl(url, {quality: 'highestaudio', filter: 'audioonly'}).pipe(fs.createWriteStream(args.AUDIO_DIR + info.title + '.' + info.formats[0].container));
            message.channel.send('Downloaded ' + info.title);
        }
        else
        {
            message.channel.send('That YouTube clip is too long for a soundclip');
        }
    }
    else
    {
        message.channel.send('Not a valid YouTube video!');
    }
}

module.exports = {
    name: 'youtube-dl',
    execute: download
};