package com.mine.focus;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import java.util.Calendar;

/**
 * 每天本地时间 00:00:05 刷新倒数日天数。
 * 用 setAndAllowWhileIdle，不申请精确闹钟权限，也不起常驻服务。
 * 系统可以稍微推迟；DATE_CHANGED / TIME_SET / TIMEZONE_CHANGED / 开机再补一次。
 */
public final class CountdownWidgetScheduler {
    static final String ACTION_MIDNIGHT = "com.mine.focus.action.COUNTDOWN_WIDGET_MIDNIGHT";
    static final int REQUEST_CODE = 25311;

    private CountdownWidgetScheduler() {}

    public static void scheduleNext(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        long at = nextTriggerAt();
        PendingIntent pendingIntent = alarmIntent(context);
        try {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent);
        } catch (SecurityException error) {
            manager.set(AlarmManager.RTC_WAKEUP, at, pendingIntent);
        }
    }

    public static void cancel(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            new Intent(context, CountdownWidgetProvider.class).setAction(ACTION_MIDNIGHT),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pendingIntent != null) {
            manager.cancel(pendingIntent);
            pendingIntent.cancel();
        }
    }

    static long nextTriggerAt() {
        Calendar calendar = Calendar.getInstance();
        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 5);
        calendar.set(Calendar.MILLISECOND, 0);
        if (calendar.getTimeInMillis() <= System.currentTimeMillis()) {
            calendar.add(Calendar.DAY_OF_YEAR, 1);
        }
        return calendar.getTimeInMillis();
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, CountdownWidgetProvider.class).setAction(ACTION_MIDNIGHT);
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
