package com.mine.focus;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

// 计时进行中：在通知栏显示常驻的倒计时通知，用户无需切回应用即可看到剩余时间。
public class FocusTimerService extends Service {
    private static final String CHANNEL_ID = "focus-timer-progress";
    private static final int NOTIFICATION_ID = 25006;
    private static final String PREFERENCES = "focus_timer_state";

    static void start(Context context, String task, long endAt) {
        Intent service = new Intent(context, FocusTimerService.class)
            .putExtra("task", task)
            .putExtra("endAt", endAt);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(service);
        else context.startService(service);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, FocusTimerService.class));
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().clear().apply();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        String task = (intent != null && intent.getStringExtra("task") != null)
            ? intent.getStringExtra("task")
            : preferences.getString("task", "专注中");
        long endAt = (intent != null && intent.getLongExtra("endAt", 0) > 0)
            ? intent.getLongExtra("endAt", 0)
            : preferences.getLong("endAt", 0);
        if (task == null || task.isEmpty()) task = "专注中";
        preferences.edit().putString("task", task).putLong("endAt", endAt).apply();
        startForeground(NOTIFICATION_ID, buildNotification(task, endAt));
        return START_NOT_STICKY;
    }

    private Notification buildNotification(String task, long endAt) {
        Intent openIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(
            this, 25007, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_focus)
            .setContentTitle(task)
            .setContentText("正在计时，点按返回应用")
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        if (endAt > 0) {
            builder.setWhen(endAt)
                .setUsesChronometer(true)
                .setChronometerCountDown(true);
        }
        return builder.build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "计时进行中", NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("专注或休息进行中时显示剩余时间");
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
