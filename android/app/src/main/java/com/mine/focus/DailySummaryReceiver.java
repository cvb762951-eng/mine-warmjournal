package com.mine.focus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 每日小结定时触发 + 设备重启重排。
 * - ACTION_DAILY_SUMMARY：02:00 触发 → 拉起 MainActivity（extra auto_summary=1，静默模式）→ 重排下一天。
 * - BOOT_COMPLETED：设备重启后重排定时任务。
 */
public class DailySummaryReceiver extends BroadcastReceiver {
    public static final String ACTION_DAILY_SUMMARY = "com.mine.focus.action.DAILY_SUMMARY";
    public static final String EXTRA_AUTO_SUMMARY = "auto_summary";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            DailySummaryScheduler.scheduleNext(context);
            return;
        }
        if (ACTION_DAILY_SUMMARY.equals(action)) {
            // 拉起 App 走静默模式（不响铃不震动不通知；勿扰由系统静默拉起保证）
            Intent launch = new Intent(context, MainActivity.class)
                .setAction(ACTION_DAILY_SUMMARY)
                .putExtra(EXTRA_AUTO_SUMMARY, 1)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launch);
            // 触发后重排下一天
            DailySummaryScheduler.scheduleNext(context);
        }
    }
}
