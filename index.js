require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Colors, PermissionsBitField, AuditLogEvent } = require('discord.js');
const db = require('./database');
const config = require('./config.json');

const OWNER_ID = process.env.OWNER_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildInvites,
    ]
});

function getLogChannel(guild) {
    const id = db.getLogChannel();
    return id ? guild.channels.cache.get(id) : null;
}

function logEmbed(title, fields, color = Colors.Blue) {
    return new EmbedBuilder()
        .setTitle(title)
        .addFields(fields)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Voice Logger' });
}

// ─── slash commands ───
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // حماية الرابط = أونر البوت فقط
    if (commandName === 'vanity-protect') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({
                content: 'هذا الأمر لصاحب البوت فقط.',
                ephemeral: true
            });
        }
        const on = interaction.options.getBoolean('enabled');
        db.toggleVanityProtection(on);
        return interaction.reply({
            content: on ? 'حماية الرابط مفعلة.' : 'حماية الرابط معطلة.',
            ephemeral: true
        });
    }

    // باقي الأوامر = الإدارة فقط
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
            content: 'هذا الأمر للإدارة فقط.',
            ephemeral: true
        });
    }

    if (commandName === 'setlog') {
        const ch = interaction.options.getChannel('channel');
        db.setLogChannel(ch.id);
        return interaction.reply({
            content: `تم تحديد ${ch} روم اللوق.`,
            ephemeral: true
        });
    }

    if (commandName === 'afk-voice') {
        const ch = interaction.options.getChannel('channel');
        db.setAfkChannel(ch.id);
        return interaction.reply({
            content: `تم تحديد ${ch} روم AFK.`,
            ephemeral: true
        });
    }

    if (commandName === 'settings') {
        const logCh = db.getLogChannel() ? `<#${db.getLogChannel()}>` : 'غير محدد';
        const afkCh = db.getAfkChannel() ? `<#${db.getAfkChannel()}>` : 'غير محدد';
        const vanity = db.isVanityProtectionEnabled() ? 'مفعلة' : 'معطلة';

        const embed = new EmbedBuilder()
            .setTitle('إعدادات البوت')
            .addFields(
                { name: 'روم اللوق', value: logCh, inline: true },
                { name: 'روم AFK', value: afkCh, inline: true },
                { name: 'حماية الرابط', value: vanity, inline: true }
            )
            .setColor(Colors.Gold)
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// ─── voice state logging (admin actions only) ───
client.on('voiceStateUpdate', async (oldState, newState) => {
    const logCh = getLogChannel(newState.guild);
    if (!logCh) return;

    const member = newState.member;
    const oldCh = oldState.channel;
    const newCh = newState.channel;

    // Server Mute
    if (oldState.serverMute !== newState.serverMute) {
        const action = newState.serverMute ? 'كتم الصوت' : 'فك الكتم';
        const color = newState.serverMute ? Colors.Red : Colors.Green;

        setTimeout(async () => {
            try {
                const audit = await newState.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberUpdate,
                    limit: 5
                });
                const entry = audit.entries.find(e =>
                    e.target.id === member.id &&
                    e.createdTimestamp > Date.now() - 4000 &&
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
        }, 800);
    }

    // Server Deaf
    if (oldState.serverDeaf !== newState.serverDeaf) {
        const action = newState.serverDeaf ? 'دفن السماعة' : 'فك الدفن';
        const color = newState.serverDeaf ? Colors.Red : Colors.Green;

        setTimeout(async () => {
            try {
                const audit = await newState.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberUpdate,
                    limit: 5
                });
                const entry = audit.entries.find(e =>
                    e.target.id === member.id &&
                    e.createdTimestamp > Date.now() - 4000 &&
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
        }, 800);
    }

    // Disconnect
    if (oldCh && !newCh) {
        setTimeout(async () => {
            try {
                const audit = await oldState.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberDisconnect,
                    limit: 3
                });
                const entry = audit.entries.find(e =>
                    e.target.id === member.id &&
                    e.createdTimestamp > Date.now() - 4000
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
        }, 800);
    }
});

// ─── vanity protection ───
client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!db.isVanityProtectionEnabled()) return;
    if (!config.vanityURL) return;

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

                // 1. لوق: اكتشاف التغيير
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

                // 2. إرجاع الرابط
                let restored = false;
                try {
                    await newGuild.setVanityCode(config.vanityURL);
                    restored = true;
                } catch (e) {
                    console.error('Failed to restore vanity:', e);
                }

                // 3. لوق: نتيجة الإرجاع
                if (logCh) {
                    const restoreEmbed = new EmbedBuilder()
                        .setTitle(restored ? 'تم إرجاع الرابط' : 'فشل إرجاع الرابط')
                        .setDescription(
                            restored
                                ? `تم إرجاع الرابط إلى: discord.gg/${config.vanityURL}`
                                : 'لم يتمكن البوت من إرجاع الرابط، تحقق من الصلاحيات.'
                        )
                        .setColor(restored ? Colors.Green : Colors.DarkOrange)
                        .setTimestamp();
                    await logCh.send({ embeds: [restoreEmbed] });
                }

                // 4. باند
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

                // 5. لوق: نتيجة الباند
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

// ─── ready ───
client.once('ready', () => {
    console.log(`البوت شغال: ${client.user.tag}`);
    client.user.setActivity('Voice Logger', { type: 4 });
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(process.env.TOKEN);