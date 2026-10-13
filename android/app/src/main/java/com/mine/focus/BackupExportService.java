package com.mine.focus;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

// 大容量备份可能持续数十分钟。前台服务与局部唤醒锁只在导出期间存在，避免系统回收进程。
public class BackupExportService extends Service {
    private static final String CHANNEL_ID = "backup-export-progress";
    private static final int NOTIFICATION_ID = 25010;
    private static final long MAX_WAKE_MILLIS = 6L * 60L * 60L * 1000L;
    private static volatile BackupExportService activeInstance;

    private PowerManager.WakeLock wakeLock;
    private long totalBytes;
    private String operation = "export";

    static void start(Context context, long totalBytes) {
        start(context, totalBytes, "export");
    }

    static void start(Context context, long totalBytes, String operation) {
        Intent intent = new Intent(context, BackupExportService.class)
            .putExtra("totalBytes", totalBytes)
            .putExtra("operation", operation);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    static void update(long completedBytes, long totalBytes) {
        BackupExportService service = activeInstance;
        if (service != null) service.showProgress(completedBytes, totalBytes);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, BackupExportService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        createChannel();
        PowerManager power = (PowerManager)getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MineWarmJournal:BackupExport");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(MAX_WAKE_MILLIS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        totalBytes = intent == null ? 0L : Math.max(0L, intent.getLongExtra("totalBytes", 0L));
        operation = intent == null ? "export" : intent.getStringExtra("operation");
        if (!"restore".equals(operation) && !"verify".equals(operation)) operation = "export";
        startForeground(NOTIFICATION_ID, buildNotification(0L, totalBytes));
        return START_NOT_STICKY;
    }

    private void showProgress(long completedBytes, long expectedBytes) {
        if (expectedBytes > 0) totalBytes = expectedBytes;
        getSystemService(NotificationManager.class).notify(
            NOTIFICATION_ID,
            buildNotification(Math.max(0L, completedBytes), totalBytes)
        );
    }

    private Notification buildNotification(long completedBytes, long expectedBytes) {
        Intent openIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(
            this, 25011, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_focus)
            .setContentTitle(operationTitle())
            .setContentText(progressText(completedBytes, expectedBytes))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        if (expectedBytes > 0) {
            int percent = (int)Math.min(100L, completedBytes * 100L / expectedBytes);
            builder.setProgress(100, percent, false);
        } else {
            builder.setProgress(0, 0, true);
        }
        return builder.build();
    }

    private String progressText(long completedBytes, long expectedBytes) {
        if (expectedBytes <= 0) return operationVerb() + "，请勿强制结束应用";
        return formatBytes(completedBytes) + " / " + formatBytes(expectedBytes) + " · 请勿强制结束应用";
    }

    private String operationTitle() {
        if ("restore".equals(operation)) return "正在恢复加密备份";
        if ("verify".equals(operation)) return "正在验证加密备份";
        return "正在导出加密备份";
    }

    private String operationVerb() {
        if ("restore".equals(operation)) return "正在完整解密并恢复";
        if ("verify".equals(operation)) return "正在完整解密并验证";
        return "正在分块写入";
    }

    private String formatBytes(long bytes) {
        double gib = bytes / (1024d * 1024d * 1024d);
        if (gib >= 1d) return String.format(java.util.Locale.US, "%.1f GB", gib);
        double mib = bytes / (1024d * 1024d);
        return String.format(java.util.Locale.US, "%.0f MB", mib);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "备份与恢复", NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("处理大容量加密备份时显示进度");
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        activeInstance = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
