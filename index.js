require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, EmbedBuilder, Colors, PermissionsBitField, AuditLogEvent, MessageFlags } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const db = require('./database');

const OWNER_ID = process.env.OWNER_ID;

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Cypher is running');
});
server.listen(process.env.PORT || 3000, () => {
    console.log(`HTTP server on port ${process.env.PORT || 3000}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildInvites,
    ]
});

let botReadyAt = 0;

function getLogChannel(guild) {
    const id = db.getLogChannel(guild.id);
    return id ? guild.channels.cache.get(id) : null;
}

function logEmbed(title, fields, color = Colors.Blue) {
    return new EmbedBuilder()
        .setTitle(title)
        .addFields(fields)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Cypher' });
}

function isAboveBot(member, guild) {
    const botMember = guild.members.me;
    return member.roles.highest.position > botMember.roles.highest.position;
}

const slashCommands = [
    {
        name: 'setlog',
        description: 'تحديد روم لوق الفويسات',
        type: 1,
        default_member_permissions: '8',
        options: [
            {
                name: 'channel',
                description: 'اختر روم اللوق',
                type: 7,
                channel_types: [0],
                required: true
            }
        ]
    },
    {
        name: 'afk-voice',
        description: 'يدخل البوت روم الفويس المحدد',
        type: 1,
        default_member_permissions: '8',
        options: [
            {
                name: 'channel',
                description: 'اختر روم الفويس',
                type: 7,
                channel_types: [2],
                required: true
            }
        ]
    },
    {
        name: 'setvanity',
        description: 'تحديد رابط السيرفر المخصص للحماية',
        type: 1,
        default_member_permissions: '8',
        options: [
            {
                name: 'url',
                description: 'اكتب الرابط بدون discord.gg/ مثلاً: ab10',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'vanity-protect',
        description: 'تفعيل/تعطيل حماية رابط السيرفر',
        type: 1,
        default_member_permissions: '8',
        options: [
            {
                name: 'enabled',
                description: 'تفعيل أو تعطيل',
                type: 5,
                required: true
            }
        ]
    },
    {
        name: 'settings',
        description: 'عرض إعدادات البوت الحالية',
        type: 1,
        default_member_permissions: '8'
    }
];

// تسجيل السلاشات فوراً لما يدخل سيرفر جديد
client.on('guildCreate', async (guild) => {
    try {
        await guild.commands.set(slashCommands);
        console.log(`تم تسجيل السلاشات فوراً في: ${guild.name}`);
    } catch (err) {
        console.error(`فشل تسجيل السلاشات في ${guild.name}:`, err);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) return;

    const { commandName } = interaction;
    const guildId = interaction.guild.id;

    if (commandName === 'vanity-protect') {
        if (!isAboveBot(interaction.member, interaction.guild) && interaction.user.id !== OWNER_ID) {
            return interaction.reply({
                content: 'لازم تكون فوق البوت عشان تستخدم هذا الأمر.',
                flags: MessageFlags.Ephemeral
            });
        }
        const on = interaction.options.getBoolean('enabled');
        db.toggleVanityProtection(guildId, on);
        return interaction.reply({
            content: on ? 'حماية الرابط مفعلة.' : 'حماية الرابط معطلة.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
            content: 'هذا الأمر للإدارة فقط.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (commandName === 'setlog') {
        const ch = interaction.options.getChannel('channel');
        db.setLogChannel(guildId, ch.id);
        return interaction.reply({
            content: `تم تحديد ${ch} روم اللوق.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (commandName === 'afk-voice') {
        const ch = interaction.options.getChannel('channel');

        try {
            joinVoiceChannel({
                channelId: ch.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            return interaction.reply({
                content: `دخلت ${ch} وأنا AFK هناك الآن.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (err) {
            console.error(err);
            return interaction.reply({
                content: 'ما قدرت أدخل الروم، تأكد من صلاحياتي.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    if (commandName === 'setvanity') {
        const url = interaction.options.getString('url').trim();
        db.setVanityURL(guildId, url);
        return interaction.reply({
            content: `تم تحديد رابط السيرفر: discord.gg/${url}`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (commandName === 'settings') {
        const logCh = db.getLogChannel(guildId) ? `<#${db.getLogChannel(guildId)}>` : 'غير محدد';
        const vanity = db.isVanityProtectionEnabled(guildId) ? 'مفعلة' : 'معطلة';
        const vanityURL = db.getVanityURL(guildId) || 'غير محدد';
        const voiceConnection = interaction.guild.members.me?.voice?.channel;
        const afkStatus = voiceConnection ? `في ${voiceConnection}` : 'برا الفويس';

        const embed = new EmbedBuilder()
            .setTitle('إعدادات البوت')
            .addFields(
                { name: 'روم اللوق', value: logCh, inline: true },
                { name: 'رابط السيرفر', value: `discord.gg/${vanityURL}`, inline: true },
                { name: 'حماية الرابط', value: vanity, inline: true },
                { name: 'الحالة', value: afkStatus, inline: true }
            )
            .setColor(Colors.Gold)
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (Date.now() - botReadyAt < 5000) return;

    const logCh = getLogChannel(newState.guild);
    if (!logCh) return;

    const member = newState.member;
    const oldCh = oldState.channel;
    const newCh = newState.channel;

    if (oldState.serverMute !== newState.serverMute) {
        const action = newState.serverMute ? 'كتم الصوت' : 'فك الكتم';
        const color = newState.serverMute ? Colors.Red : Colors.Green;

        setTimeout(async () => {
            try {
                const audit = await newState.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberUpdate,
                    limit: 10
                });
                const entry = audit.entries.find(e =>
                    e.target.id === member.id &&
                    e.createdTimestamp > Date.now() - 10000 &&
                    e.changes.some(c => c.key === 'mute')
                );

                const by = entry ? `<@${entry.executor.id}>` : 'غير معروف';

                const embed = logEmbed(action, [
                    { name: 'العضو', value: `<@${member.id}>`, inline: true },
                    { name: 'القناة', value: (newCh || oldCh)?.name || 'غير معروف', inline: true },
                    { name: 'بواسطة', value: by, inline: true },
                ], color);

                await logCh.send({ embeds: [embed] });
            } catch (e) {
                console.error('Mute audit error:', e);
            }
        }, 1500);
    }

    if (oldState.serverDeaf !== newState.serverDeaf) {
        const action = newState.serverDeaf ? 'دفن السماعة' : 'فك الدفن';
        const color = newState.serverDeaf ? Colors.Red : Colors.Green;

        setTimeout(async () => {
            try {
                const audit = await newState.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberUpdate,
                    limit: 10
                });
                const entry = audit.entries.find(e =>
                    e.target.id === member.id &&
                    e.createdTimestamp > Date.now() - 10000 &&
                    e.changes.some(c => c.key === 'deaf')
                );

                const by = entry ? `<@${entry.executor.id}>` : 'غير معروف';

                const embed = logEmbed(action, [
                    { name: 'العضو', value: `<@${member.id}>`, inline: true },
                    { name: 'القناة', value: (newCh || oldCh)?.name || 'غير معروف', inline: true },
                    { name: 'بواسطة', value: by, inline: true },
                ], color);

                await logCh.send({ embeds: [embed] });
            } catch (e) {
                console.error('Deaf audit error:', e);
            }
        }, 1500);
    }

    if (oldCh && !newCh) {
        setTimeout(async () => {
            try {
                const audit = await oldState.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberDisconnect,
                    limit: 10
                });
                const entry = audit.entries.find(e =>
                    e.target.id === member.id &&
                    e.createdTimestamp > Date.now() - 10000
                );

                if (entry) {
                    const embed = logEmbed('طرد من الفويس', [
                        { name: 'العضو', value: `<@${member.id}>`, inline: true },
                        { name: 'القناة', value: oldCh.name, inline: true },
                        { name: 'الطارد', value: `<@${entry.executor.id}>`, inline: true },
                    ], Colors.DarkRed);

                    await logCh.send({ embeds: [embed] });
                }
            } catch (e) {
                console.error('Disconnect audit error:', e);
            }
        }, 1500);
    }
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    const guildId = newGuild.id;
    if (!db.isVanityProtectionEnabled(guildId)) return;
    
    const vanityURL = db.getVanityURL(guildId);
    if (!vanityURL) return;

    const oldVanity = oldGuild.vanityURLCode;
    const newVanity = newGuild.vanityURLCode;

    if (oldVanity && oldVanity !== newVanity) {
        const logCh = getLogChannel(newGuild);

        try {
            const audit = await newGuild.fetchAuditLogs({
                type: AuditLogEvent.GuildUpdate,
                limit: 5
            });
            const entry = audit.entries.find(e =>
                e.createdTimestamp > Date.now() - 3000 &&
                e.executor.id !== client.user.id
            );

            if (entry) {
                const executor = entry.executor;

                if (logCh) {
                    const detectEmbed = new EmbedBuilder()
                        .setTitle('تنبيه: رابط السيرفر تغيّر')
                        .addFields(
                            { name: 'الشخص', value: `<@${executor.id}>`, inline: true },
                            { name: 'الرابط القديم', value: `discord.gg/${oldVanity}`, inline: true },
                            { name: 'الرابط الجديد', value: newVanity ? `discord.gg/${newVanity}` : 'تم الحذف', inline: true }
                        )
                        .setColor(Colors.Orange)
                        .setTimestamp();
                    await logCh.send({ embeds: [detectEmbed] });
                }

                let restored = false;
                try {
                    await newGuild.edit({ vanityURLCode: vanityURL });
                    restored = true;
                } catch (e) {
                    console.error('Failed to restore vanity:', e.message);
                }

                if (logCh) {
                    const restoreEmbed = new EmbedBuilder()
                        .setTitle(restored ? 'تم إرجاع الرابط' : 'فشل إرجاع الرابط')
                        .setDescription(
                            restored
                                ? `تم إرجاع الرابط إلى: discord.gg/${vanityURL}`
                                : 'لم يتمكن البوت من إرجاع الرابط، تحقق من الصلاحيات.'
                        )
                        .setColor(restored ? Colors.Green : Colors.DarkOrange)
                        .setTimestamp();
                    await logCh.send({ embeds: [restoreEmbed] });
                }

                let banned = false;
                try {
                    const member = await newGuild.members.fetch(executor.id);
                    if (member) {
                        await member.ban({ reason: 'حماية الرابط: محاولة تغيير الرابط' });
                        banned = true;
                    }
                } catch (e) {
                    console.error('Failed to ban:', e);
                }

                if (logCh) {
                    const banEmbed = new EmbedBuilder()
                        .setTitle(banned ? 'تم الباند' : 'فشل الباند')
                        .setDescription(
                            banned
                                ? `<@${executor.id}> تم حظره من السيرفر.`
                                : `لم يتمكن البوت من حظر <@${executor.id}>، تحقق من الترتيب.`
                        )
                        .setColor(banned ? Colors.Red : Colors.DarkOrange)
                        .setTimestamp();
                    await logCh.send({ embeds: [banEmbed] });
                }
            }
        } catch (err) {
            console.error('Vanity error:', err);
        }
    }
});

client.once('ready', () => {
    botReadyAt = Date.now();
    console.log(`Cypher شغال: ${client.user.tag}`);
    console.log(`في ${client.guilds.cache.size} سيرفر`);
    client.user.setActivity('Cypher', { type: 4 });
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(process.env.TOKEN);
