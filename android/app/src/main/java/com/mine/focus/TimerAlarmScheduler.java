package com.mine.focus;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

final class TimerAlarmScheduler {
    static final int REQUEST_CODE = 25002;

    private TimerAlarmScheduler() {}

    static void schedule(Context context, long at, String task, String label) {
        cancelScheduled(context);
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pendingIntent = alarmIntent(context, task, label);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent);
            } catch (SecurityException error) {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent);
            }
        } else {
            manager.setExact(AlarmManager.RTC_WAKEUP, at, pendingIntent);
        }
    }

    static void cancelScheduled(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, TimerAlarmReceiver.class).setAction(TimerAlarmReceiver.ACTION_RING);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context, REQUEST_CODE, intent, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pendingIntent != null) {
            manager.cancel(pendingIntent);
            pendingIntent.cancel();
        }
    }

    private static PendingIntent alarmIntent(Context context, String task, String label) {
        Intent intent = new Intent(context, TimerAlarmReceiver.class)
            .setAction(TimerAlarmReceiver.ACTION_RING)
            .putExtra("task", task)
            .putExtra("label", label);
        return PendingIntent.getBroadcast(
            context, REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
