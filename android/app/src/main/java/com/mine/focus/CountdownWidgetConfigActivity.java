package com.mine.focus;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RadioButton;
import android.widget.RadioGroup;

import java.util.List;

/** 添加或长按重新配置时，选择这个小组件显示哪一条。界面保持原生控件，颜色走主题资源。 */
public class CountdownWidgetConfigActivity extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private RadioGroup choices;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        widgetId = getIntent() == null
            ? AppWidgetManager.INVALID_APPWIDGET_ID
            : getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        setContentView(R.layout.countdown_widget_config);
        choices = findViewById(R.id.countdown_config_choices);
        List<CountdownDays.Spec> items = CountdownWidgetStore.items(this);
        String selected = CountdownWidgetStore.selection(this, widgetId);
        addChoice("最近的一个", "");
        boolean matched = selected == null || selected.isEmpty();
        if (matched) ((RadioButton) choices.getChildAt(0)).setChecked(true);
        if (items.isEmpty()) findViewById(R.id.countdown_config_empty).setVisibility(View.VISIBLE);
        for (CountdownDays.Spec spec : items) {
            RadioButton button = addChoice(spec.title, spec.id);
            if (spec.id.equals(selected)) {
                button.setChecked(true);
                matched = true;
            }
        }
        if (!matched) ((RadioButton) choices.getChildAt(0)).setChecked(true);
        CountdownWidgetTheme.applyConfig(this);
        findViewById(R.id.countdown_config_save).setOnClickListener(view -> save());
    }

    private RadioButton addChoice(String label, String countdownId) {
        RadioButton button = new RadioButton(this);
        button.setText(label);
        button.setTag(countdownId);
        button.setId(View.generateViewId());
        choices.addView(button);
        return button;
    }

    private void save() {
        int checked = choices.getCheckedRadioButtonId();
        RadioButton button = checked == -1 ? null : choices.findViewById(checked);
        String countdownId = button == null || button.getTag() == null ? "" : String.valueOf(button.getTag());
        CountdownWidgetStore.saveSelection(this, widgetId, countdownId);
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        CountdownWidgetScheduler.scheduleNext(this);
        CountdownWidgetProvider.updateWidget(this, manager, widgetId);
        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }
}
