/* ─── Vanity Protection (Fixed & Enhanced) ─── */

const vanityState = new Map(); // guildId -> { lastCode, checking: boolean }

// ── تفقد دوري كل 3 ثواني ──
setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
        const guildId = guild.id;
        if (!db.isVanityProtectionEnabled(guildId)) continue;

        const savedURL = db.getVanityURL(guildId);
        if (!savedURL) continue;

        try {
            const vanity = await guild.fetchVanityData().catch(() => null);
            if (!vanity || !vanity.code) continue;

            const currentCode = vanity.code;

            // Double-check: استدعي مرة ثانية بعد ثانية للتأكد
            if (currentCode !== savedURL) {
                await new Promise(r => setTimeout(r, 1000));
                const recheck = await guild.fetchVanityData().catch(() => null);
                
                if (!recheck || recheck.code === savedURL) {
                    console.log(`[Vanity] False alarm in ${guild.name}, skipping.`);
                    continue;
                }

                console.log(`[Vanity Polling] ${guild.name}: Current=${recheck.code}, Expected=${savedURL}`);
                await handleVanityChange(guild, savedURL, recheck.code, 'polling');
            }

            vanityState.set(guildId, { lastCode: currentCode, checking: false });

        } catch (err) {
            console.error(`[Vanity Polling Error] ${guild.name}:`, err.message);
        }
    }
}, 3000);

// ── الحدث التقليدي (احتياطي) ──
client.on('guildUpdate', async (oldGuild, newGuild) => {
    const guildId = newGuild.id;
    if (!db.isVanityProtectionEnabled(guildId)) return;

    const savedURL = db.getVanityURL(guildId);
    if (!savedURL) return;

    const oldVanity = oldGuild.vanityURLCode;
    const newVanity = newGuild.vanityURLCode;

    // لو ما تغيّر الرابط بالتحديد، تجاهل
    if (!oldVanity && !newVanity) return;
    if (oldVanity === newVanity) return;

    console.log(`[Vanity Event] ${newGuild.name}: ${oldVanity} -> ${newVanity}`);

    // تحقق فعلي من Discord API
    try {
        const vanity = await newGuild.fetchVanityData().catch(() => null);
        if (!vanity) return;
        
        if (vanity.code !== savedURL) {
            await handleVanityChange(newGuild, savedURL, vanity.code, 'event');
        }
    } catch (e) {
        console.error('[Vanity Event Error]', e.message);
    }
});

// ── المعالج الرئيسي ──
async function handleVanityChange(guild, targetURL, currentCode, source) {
    const guildId = guild.id;
    
    // تجنب التكرار
    if (vanityState.get(guildId)?.checking) return;
    
    // تأكد فعلاً إن الرابط ما هو المطلوب
    if (currentCode === targetURL) {
        console.log(`[Vanity] Already correct, skipping.`);
        return;
    }
    
    // تأكد مرة ثالثة قبل الإجراء
    const finalCheck = await guild.fetchVanityData().catch(() => null);
    if (!finalCheck || finalCheck.code === targetURL) {
        console.log(`[Vanity] Final check passed, no action needed.`);
        return;
    }

    vanityState.set(guildId, { lastCode: currentCode, checking: true });

    console.log(`[Vanity] CONFIRMED change in ${guild.name} via ${source}`);

    const logCh = getLogChannel(guild);
    let executor = null;

    // ── جلب المُنفّذ من Audit Log ──
    try {
        const audit = await guild.fetchAuditLogs({ 
            type: AuditLogEvent.GuildUpdate, 
            limit: 10 
        });
        const entry = audit.entries.find(e => 
            e.createdTimestamp > Date.now() - 15000 && 
            e.executor && 
            e.executor.id !== client.user.id
        );
        if (entry?.executor) executor = entry.executor;
    } catch (e) {
        console.error('[Audit Log Error]', e.message);
    }

    // ── سجل التنبيه ──
    if (logCh) {
        await logCh.send({ embeds: [new EmbedBuilder()
            .setTitle('🚨 تنبيه: رابط السيرفر تغيّر!')
            .setDescription(`**المصدر:** ${source === 'event' ? 'حدث فوري' : 'فحص دوري'}`)
            .addFields(
                { name: '👤 المُنفّذ', value: executor ? `<@${executor.id}> (${executor.tag})` : 'غير معروف', inline: true },
                { name: '🔗 الرابط الحالي', value: currentCode ? `discord.gg/${currentCode}` : 'تم الحذف', inline: true },
                { name: '🔗 الرابط المطلوب', value: `discord.gg/${targetURL}`, inline: true }
            )
            .setColor(Colors.Orange)
            .setTimestamp()] }).catch(() => {});
    }

    // ── محاولات إرجاع الرابط (5 محاولات) ──
    let restored = false;
    for (let i = 1; i <= 5; i++) {
        try {
            console.log(`[Vanity] Restore attempt ${i}/5 for ${guild.name}...`);
            await guild.edit({ vanityURLCode: targetURL });
            
            // تحقق من نجاح الإرجاع
            await new Promise(r => setTimeout(r, 1500));
            const verify = await guild.fetchVanityData().catch(() => null);
            
            if (verify && verify.code === targetURL) {
                restored = true;
                console.log(`[Vanity] ✅ Verified restored on attempt ${i}!`);
                break;
            } else {
                console.log(`[Vanity] ⚠️ Attempt ${i} API succeeded but code mismatch, retrying...`);
            }
        } catch (err) {
            console.error(`[Vanity] ❌ Attempt ${i} failed:`, err.message);
            if (i < 5) {
                const delay = i * 2000;
                console.log(`[Vanity] Waiting ${delay}ms before retry...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    // ── سجل نتيجة الإرجاع ──
    if (logCh) {
        await logCh.send({ embeds: [new EmbedBuilder()
            .setTitle(restored ? '✅ تم إرجاع الرابط وتم التحقق' : '❌ فشل الإرجاع نهائياً')
            .setDescription(restored 
                ? `discord.gg/${targetURL} (تم التحقق من Discord API)` 
                : 'تأكد من:\n• صلاحية Manage Server\n• الرابط غير محجوز\n• السيرفر يملك Boost Level 3')
            .setColor(restored ? Colors.Green : Colors.Red)
            .setTimestamp()] }).catch(() => {});
    }

    // ── باند المُنفّذ ──
    if (executor && executor.id !== OWNER_ID) {
        let banned = false;
        for (let i = 1; i <= 2; i++) {
            try {
                const member = await guild.members.fetch(executor.id).catch(() => null);
                if (!member) break;
                
                await member.ban({ reason: '🛡️ حماية الرابط - تغيير الاختصار' });
                banned = true;
                console.log(`[Vanity] 🔨 Banned ${executor.tag}`);
                break;
            } catch (err) {
                console.error(`[Vanity] Ban attempt ${i} failed:`, err.message);
                if (i < 2) await new Promise(r => setTimeout(r, 3000));
            }
        }

        if (logCh) {
            await logCh.send({ embeds: [new EmbedBuilder()
                .setTitle(banned ? '🔨 تم الحظر' : '⚠️ فشل الحظر')
                .setDescription(banned 
                    ? `<@${executor.id}> تم الحظر نهائياً.` 
                    : 'تحقق من ترتيب الرتب (يجب أن تكون رتبة البوت أعلى).')
                .setColor(banned ? Colors.Red : Colors.DarkOrange)
                .setTimestamp()] }).catch(() => {});
        }
    } else if (executor?.id === OWNER_ID) {
        console.log('[Vanity] Owner was executor, skipped ban.');
        if (logCh) {
            await logCh.send({ embeds: [new EmbedBuilder()
                .setTitle('👑 Owner تجاوز الحظر')
                .setDescription('مالك السيرفر هو من غيّر الرابط، تم الإرجاع بدون حظر.')
                .setColor(Colors.Blue)
                .setTimestamp()] }).catch(() => {});
        }
    }

    vanityState.set(guildId, { lastCode: targetURL, checking: false });
}
