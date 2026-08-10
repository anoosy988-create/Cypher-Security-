require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('تحديد روم لوق الفويسات')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('اختر روم اللوق')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('afk-voice')
        .setDescription('يدخل البوت روم الفويس المحدد')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('اختر روم الفويس')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('vanity-protect')
        .setDescription('تفعيل/تعطيل حماية رابط السيرفر')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('تفعيل أو تعطيل')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('عرض إعدادات البوت الحالية')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('جاري نشر السلاش كوماند...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('تم نشر السلاش كوماند بنجاح!');
    } catch (error) {
        console.error('خطأ في النشر:', error);
    }
})();
