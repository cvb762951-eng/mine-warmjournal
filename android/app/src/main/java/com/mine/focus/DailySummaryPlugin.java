package com.mine.focus;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 每日小结静默模式桥接：
 * - isAutoSummaryLaunch()：本次启动是否由凌晨定时器拉起（静默模式），供 JS 判断执行「生成前一天小结后退出」。
 * - finishAutoSummary()：JS 生成完成后调用，Activity finish 退出（避免驻留）。
 */
@CapacitorPlugin(name = "DailySummary")
public class DailySummaryPlugin extends Plugin {

    @PluginMethod
    public void scheduleNext(PluginCall call) {
        DailySummaryScheduler.scheduleNext(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isAutoSummaryLaunch(PluginCall call) {
        JSObject result = new JSObject();
        result.put("autoSummary", MainActivity.isAutoSummaryLaunch());
        call.resolve(result);
    }

    @PluginMethod
    public void finishAutoSummary(PluginCall call) {
        call.resolve();
        if (MainActivity.isAutoSummaryLaunch()) {
            MainActivity.clearAutoSummaryLaunch();
            getActivity().finish();
        }
    }
}
