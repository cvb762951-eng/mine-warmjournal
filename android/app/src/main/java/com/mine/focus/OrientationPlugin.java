package com.mine.focus;

import android.content.Context;
import android.content.pm.ActivityInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 屏幕方向控制：沉浸计时用。
 * - setMode({mode:'auto'|'portrait'|'landscape'})：portrait/landscape 直接锁定方向；
 *   auto 用加速度计按重力分量判断姿态，防抖稳定 ≥400ms 才切换，且仅目标与当前不同才调。
 * - restore()：回到竖屏（App 其余页面竖屏布局）。
 * 生命周期 onDestroy/onPause 注销传感器监听，不残留方向锁定。
 */
@CapacitorPlugin(name = "Orientation")
public class OrientationPlugin extends Plugin implements SensorEventListener {

    private static final long STABLE_MS = 400;
    private static final int TARGET_PORTRAIT = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
    private static final int TARGET_LANDSCAPE = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;

    private SensorManager sensorManager = null;
    private Sensor accelerometer = null;
    private boolean listening = false;
    /** 当前生效方向（供传感器判断目标方向与当前是否相同） */
    private int currentOrientation = TARGET_PORTRAIT;
    /** 候选姿态与稳定起始时间（防抖） */
    private Integer candidate = null;
    private long candidateSince = 0;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void setMode(PluginCall call) {
        String mode = call.getString("mode", "auto");
        if (!"portrait".equals(mode) && !"landscape".equals(mode) && !"auto".equals(mode)) {
            call.reject("mode 必须是 auto / portrait / landscape");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if ("portrait".equals(mode)) {
                unregisterSensor();
                applyOrientation(TARGET_PORTRAIT);
            } else if ("landscape".equals(mode)) {
                unregisterSensor();
                applyOrientation(TARGET_LANDSCAPE);
            } else {
                startSensor();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void restore(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            unregisterSensor();
            applyOrientation(TARGET_PORTRAIT);
            call.resolve();
        });
    }

    @PluginMethod
    public void currentMode(PluginCall call) {
        JSObject result = new JSObject();
        result.put("orientation", currentOrientation == TARGET_LANDSCAPE ? "landscape" : "portrait");
        call.resolve(result);
    }

    // ---- 传感器自动识别 ----
    private void startSensor() {
        if (sensorManager == null) {
            sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        }
        if (sensorManager == null) return;
        if (accelerometer == null) {
            accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        }
        if (accelerometer == null) return;
        if (!listening) {
            sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_UI);
            listening = true;
        }
        candidate = null;
        candidateSince = 0;
    }

    private void unregisterSensor() {
        if (sensorManager != null && listening) {
            sensorManager.unregisterListener(this);
        }
        listening = false;
        candidate = null;
        candidateSince = 0;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_ACCELEROMETER) return;
        float ax = Math.abs(event.values[0]);
        float ay = Math.abs(event.values[1]);
        float az = Math.abs(event.values[2]);
        // 重力分量：|z| 最大 → 竖屏；|x| 或 |y| 最大 → 横屏
        int target = (az >= ax && az >= ay) ? TARGET_PORTRAIT : TARGET_LANDSCAPE;
        long now = System.currentTimeMillis();

        if (target == currentOrientation) {
            candidate = null;
            candidateSince = 0;
            return;
        }
        if (candidate == null || candidate != target) {
            candidate = target;
            candidateSince = now;
            return;
        }
        if (now - candidateSince < STABLE_MS) return;
        // 姿态稳定 ≥400ms 且目标与当前不同 → 切换
        candidate = null;
        candidateSince = 0;
        int pending = target;
        mainHandler.post(() -> applyOrientation(pending));
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    private void applyOrientation(int orientation) {
        if (orientation == currentOrientation) return;
        currentOrientation = orientation;
        getActivity().setRequestedOrientation(orientation);
    }

    @Override
    protected void handleOnPause() {
        unregisterSensor();
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        unregisterSensor();
        super.handleOnDestroy();
    }
}
