package com.mine.focus;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.IOException;

public class TimerAlarmService extends Service {
    private static final String CHANNEL_ID = "timer-alarm-v1";
    private static final int NOTIFICATION_ID = 25003;
    private static final String PREFERENCES = "timer_alarm_state";
    private MediaPlayer player;

    static void start(Context context, String task, String label) {
        Intent service = new Intent(context, TimerAlarmService.class)
            .putExtra("task", task)
            .putExtra("label", label);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(service);
        else context.startService(service);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        FocusTimerService.stop(this);
        android.content.SharedPreferences preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        String label = intent == null ? preferences.getString("label", "计时") : intent.getStringExtra("label");
        String task = intent == null ? preferences.getString("task", "本阶段") : intent.getStringExtra("task");
        if (label == null || label.isEmpty()) label = "计时";
        if (task == null || task.isEmpty()) task = "本阶段";
        preferences.edit().putString("label", label).putString("task", task).apply();
        startForeground(NOTIFICATION_ID, buildNotification(label, task));
        startLoopingSound();
        preferences.edit().putBoolean("ringing", true).apply();
        return START_STICKY;
    }

    private void startLoopingSound() {
        if (player != null && player.isPlaying()) return;
        try (AssetFileDescriptor sound = getResources().openRawResourceFd(R.raw.timer_complete)) {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            player.setDataSource(sound.getFileDescriptor(), sound.getStartOffset(), sound.getLength());
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (IOException | RuntimeException error) {
            if (player != null) player.release();
            player = null;
        }
    }

    private Notification buildNotification(String label, String task) {
        Intent openIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(
            this, 25004, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Intent stopIntent = new Intent(this, TimerAlarmReceiver.class).setAction(TimerAlarmReceiver.ACTION_STOP);
        PendingIntent stop = PendingIntent.getBroadcast(
            this, 25005, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_focus)
            .setContentTitle(label + "结束")
            .setContentText(task + "已结束，提示音会持续到你手动停止。")
            .setContentIntent(open)
            .addAction(0, "停止提示音", stop)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .setAutoCancel(false)
            .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "计时结束闹铃", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("专注或休息结束后持续提醒，直到手动停止");
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        if (player != null) {
            player.stop();
            player.release();
            player = null;
        }
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putBoolean("ringing", false).apply();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, TimerAlarmService.class));
        context.getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putBoolean("ringing", false).apply();
    }

    static boolean isRinging(Context context) {
        return context.getSharedPreferences(PREFERENCES, MODE_PRIVATE).getBoolean("ringing", false);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
