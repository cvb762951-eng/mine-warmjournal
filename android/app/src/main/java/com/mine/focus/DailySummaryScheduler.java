package com.mine.focus;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;

/**
 * 每日小结定时任务：每天本地时间凌晨 02:00 触发（不申请精确闹钟权限）。
 * 一次性 alarm + 触发后重排下一天（比 setRepeating 在 Doze/重启场景更可靠）。
 */
final class DailySummaryScheduler {
    static final int REQUEST_CODE = 25301;
    static final int TRIGGER_HOUR = 2;
    static final int TRIGGER_MINUTE = 0;
    private DailySummaryScheduler() {}

    static void scheduleNext(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        long at = nextTriggerAt();
        PendingIntent pendingIntent = alarmIntent(context);
        try {
            // 允许 Doze 中唤醒；仍是非精确 alarm，系统可按其节电策略延迟。
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent);
            } else {
                manager.set(AlarmManager.RTC_WAKEUP, at, pendingIntent);
            }
        } catch (SecurityException error) {
            manager.set(AlarmManager.RTC_WAKEUP, at, pendingIntent);
        }
    }

    static void cancel(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context, REQUEST_CODE, new Intent(context, DailySummaryReceiver.class).setAction(DailySummaryReceiver.ACTION_DAILY_SUMMARY),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pendingIntent != null) {
            manager.cancel(pendingIntent);
            pendingIntent.cancel();
        }
    }

    /** 下一次触发时间：今天 02:00 已过则明天 02:00 */
    private static long nextTriggerAt() {
        Calendar calendar = Calendar.getInstance();
        calendar.set(Calendar.HOUR_OF_DAY, TRIGGER_HOUR);
        calendar.set(Calendar.MINUTE, TRIGGER_MINUTE);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        long now = System.currentTimeMillis();
        if (calendar.getTimeInMillis() <= now) {
            calendar.add(Calendar.DAY_OF_YEAR, 1);
        }
        return calendar.getTimeInMillis();
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, DailySummaryReceiver.class)
            .setAction(DailySummaryReceiver.ACTION_DAILY_SUMMARY);
        return PendingIntent.getBroadcast(
            context, REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
