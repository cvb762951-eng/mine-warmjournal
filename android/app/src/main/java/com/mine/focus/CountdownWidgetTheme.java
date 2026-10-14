package com.mine.focus;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.widget.Button;
import android.widget.RadioGroup;
import android.widget.TextView;

/**
 * 桌面倒数日的主题入口。
 * 外观只通过资源切换：classic 暖色纸、plain 清简、dark 深色、sunny 暖阳。
 * 改颜色改 res/values/colors.xml 的 countdown_widget_*，
 * 改底板改 res/drawable/countdown_widget_bg_*.xml。不要在这里写死色值。
 */
public final class CountdownWidgetTheme {
    public final int backgroundDrawable;
    public final int pageColor;
    public final int titleColor;
    public final int mutedColor;
    public final int accentColor;
    public final int onAccentColor;

    private CountdownWidgetTheme(int backgroundDrawable, int pageColor, int titleColor, int mutedColor, int accentColor, int onAccentColor) {
        this.backgroundDrawable = backgroundDrawable;
        this.pageColor = pageColor;
        this.titleColor = titleColor;
        this.mutedColor = mutedColor;
        this.accentColor = accentColor;
        this.onAccentColor = onAccentColor;
    }

    public static String normalize(String theme) {
        if ("sunny".equals(theme) || "plain".equals(theme) || "dark".equals(theme)) return theme;
        return "classic";
    }

    public static CountdownWidgetTheme of(String theme) {
        switch (normalize(theme)) {
            case "sunny":
                return new CountdownWidgetTheme(
                    R.drawable.countdown_widget_bg_sunny,
                    R.color.countdown_widget_sunny_page,
                    R.color.countdown_widget_sunny_title,
                    R.color.countdown_widget_sunny_muted,
                    R.color.countdown_widget_sunny_accent,
                    R.color.countdown_widget_sunny_on_accent
                );
            case "plain":
                return new CountdownWidgetTheme(
                    R.drawable.countdown_widget_bg_plain,
                    R.color.countdown_widget_plain_page,
                    R.color.countdown_widget_plain_title,
                    R.color.countdown_widget_plain_muted,
                    R.color.countdown_widget_plain_accent,
                    R.color.countdown_widget_plain_on_accent
                );
            case "dark":
                return new CountdownWidgetTheme(
                    R.drawable.countdown_widget_bg_dark,
                    R.color.countdown_widget_dark_page,
                    R.color.countdown_widget_dark_title,
                    R.color.countdown_widget_dark_muted,
                    R.color.countdown_widget_dark_accent,
                    R.color.countdown_widget_dark_on_accent
                );
            default:
                return new CountdownWidgetTheme(
                    R.drawable.countdown_widget_bg_classic,
                    R.color.countdown_widget_classic_page,
                    R.color.countdown_widget_classic_title,
                    R.color.countdown_widget_classic_muted,
                    R.color.countdown_widget_classic_accent,
                    R.color.countdown_widget_classic_on_accent
                );
        }
    }

    /** 配置页用同一套颜色资源。布局保持最简，样式以后只改资源。 */
    public static void applyConfig(Activity activity) {
        CountdownWidgetTheme theme = of(CountdownWidgetStore.theme(activity));
        activity.findViewById(R.id.countdown_config_root).setBackgroundColor(activity.getColor(theme.pageColor));
        TextView title = activity.findViewById(R.id.countdown_config_title);
        title.setTextColor(activity.getColor(theme.titleColor));
        TextView empty = activity.findViewById(R.id.countdown_config_empty);
        empty.setTextColor(activity.getColor(theme.mutedColor));
        RadioGroup choices = activity.findViewById(R.id.countdown_config_choices);
        int choiceColor = activity.getColor(theme.titleColor);
        for (int index = 0; index < choices.getChildCount(); index++) {
            if (choices.getChildAt(index) instanceof TextView) {
                ((TextView) choices.getChildAt(index)).setTextColor(choiceColor);
            }
        }
        Button save = activity.findViewById(R.id.countdown_config_save);
        int accent = activity.getColor(theme.accentColor);
        save.setBackgroundColor(accent);
        save.setBackgroundTintList(ColorStateList.valueOf(accent));
        save.setTextColor(activity.getColor(theme.onAccentColor));
    }
}
