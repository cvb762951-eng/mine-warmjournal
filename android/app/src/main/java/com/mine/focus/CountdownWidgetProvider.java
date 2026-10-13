package com.mine.focus;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

public class CountdownWidgetProvider extends AppWidgetProvider {
    private static final String PREFERENCES = "countdown_widget";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) updateWidget(context, appWidgetManager, id);
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, CountdownWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        for (int id : ids) updateWidget(context, manager, id);
    }

    static void updateWidget(Context context, AppWidgetManager manager, int id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        String title = prefs.getString("title", "");
        int days = prefs.getInt("days", -1);
        String unit = prefs.getString("unit", "天后");
        String label = prefs.getString("label", "倒数日");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.countdown_widget_layout);
        if (days >= 0 && title != null && !title.isEmpty()) {
            views.setTextViewText(R.id.countdown_title, title);
            views.setTextViewText(R.id.countdown_days, String.valueOf(days));
            views.setTextViewText(R.id.countdown_unit, unit);
            views.setTextViewText(R.id.countdown_label, label);
        } else {
            views.setTextViewText(R.id.countdown_title, "还没有倒数日");
            views.setTextViewText(R.id.countdown_days, "—");
            views.setTextViewText(R.id.countdown_unit, "添加一个吧");
            views.setTextViewText(R.id.countdown_label, "倒数日");
        }

        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.countdown_root, pending);

        manager.updateAppWidget(id, views);
    }
}
