package com.mine.focus;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import java.util.Calendar;
import java.util.List;

public class CountdownWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        CountdownWidgetScheduler.scheduleNext(context);
        for (int id : appWidgetIds) updateWidget(context, appWidgetManager, id);
    }

    @Override
    public void onEnabled(Context context) {
        CountdownWidgetScheduler.scheduleNext(context);
    }

    @Override
    public void onDisabled(Context context) {
        CountdownWidgetScheduler.cancel(context);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        for (int id : appWidgetIds) CountdownWidgetStore.clearSelection(context, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (isRefreshAction(action)) {
            refreshAll(context);
            return;
        }
        super.onReceive(context, intent);
    }

    static void updateAll(Context context) {
        refreshAll(context);
    }

    private static boolean isRefreshAction(String action) {
        return CountdownWidgetScheduler.ACTION_MIDNIGHT.equals(action)
            || Intent.ACTION_DATE_CHANGED.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
            || Intent.ACTION_BOOT_COMPLETED.equals(action);
    }

    private static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, CountdownWidgetProvider.class));
        if (ids.length == 0) {
            CountdownWidgetScheduler.cancel(context);
            return;
        }
        CountdownWidgetScheduler.scheduleNext(context);
        for (int id : ids) updateWidget(context, manager, id);
    }

    static void updateWidget(Context context, AppWidgetManager manager, int id) {
        Calendar today = Calendar.getInstance();
        int year = today.get(Calendar.YEAR);
        int month = today.get(Calendar.MONTH) + 1;
        int day = today.get(Calendar.DAY_OF_MONTH);
        List<CountdownDays.Spec> items = CountdownWidgetStore.items(context);
        CountdownDays.Spec spec = resolve(items, CountdownWidgetStore.selection(context, id), year, month, day);
        CountdownWidgetTheme theme = CountdownWidgetTheme.of(CountdownWidgetStore.theme(context));

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.countdown_widget_layout);
        views.setInt(R.id.countdown_root, "setBackgroundResource", theme.backgroundDrawable);
        int titleColor = context.getColor(theme.titleColor);
        int mutedColor = context.getColor(theme.mutedColor);
        int accentColor = context.getColor(theme.accentColor);
        views.setTextColor(R.id.countdown_label, mutedColor);
        views.setTextColor(R.id.countdown_title, titleColor);
        views.setTextColor(R.id.countdown_days, accentColor);
        views.setTextColor(R.id.countdown_unit, mutedColor);

        String countdownId = "";
        if (spec == null) {
            views.setTextViewText(R.id.countdown_title, "还没有倒数日");
            views.setTextViewText(R.id.countdown_days, "—");
            views.setTextViewText(R.id.countdown_unit, "添加一个吧");
            views.setTextViewText(R.id.countdown_label, "倒数日");
        } else {
            CountdownDays.Copy copy = CountdownDays.copy(CountdownDays.daysUntil(spec, year, month, day));
            views.setTextViewText(R.id.countdown_title, spec.title);
            views.setTextViewText(R.id.countdown_days, copy.number);
            views.setTextViewText(R.id.countdown_unit, copy.unit);
            views.setTextViewText(R.id.countdown_label, copy.label);
            countdownId = spec.id;
        }

        Intent launch = new Intent(context, MainActivity.class);
        launch.setAction(Intent.ACTION_VIEW);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("route", "countdown");
        launch.putExtra("id", countdownId);
        launch.setData(Uri.parse("countdown://open/" + id + "?route=countdown&id=" + Uri.encode(countdownId)));
        PendingIntent pending = PendingIntent.getActivity(
            context,
            id,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.countdown_root, pending);
        manager.updateAppWidget(id, views);
    }

    static CountdownDays.Spec resolve(List<CountdownDays.Spec> items, String selectedId, int year, int month, int day) {
        if (selectedId != null && !selectedId.isEmpty()) {
            for (CountdownDays.Spec spec : items) {
                if (selectedId.equals(spec.id)) return spec;
            }
        }
        int index = CountdownDays.nearestIndex(items, year, month, day);
        return index >= 0 ? items.get(index) : null;
    }
}
