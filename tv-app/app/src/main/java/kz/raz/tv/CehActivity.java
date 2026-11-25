package kz.raz.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * Приложение «Цех»: экран для работников (ceh.html) — ведомость, задачи, Kaspi, принтеры.
 * В отличие от «Студии» здесь нет видео и снимков страницы: страница сама лёгкая и перерисовывается
 * только когда пришли новые данные, поэтому её просто показываем во весь экран.
 * Музыку играет сама приставка (тот же плеер, что в «Студии»), страница передаёт ей настройки.
 * Пульт: ОК — пауза/музыка, ← → — трек назад/вперёд, ↑ три раза — проверить обновления, «Назад» дважды — выход.
 */
public class CehActivity extends Activity {
  private final Handler h = new Handler(Looper.getMainLooper());
  private FrameLayout root;
  private WebView web;
  private TextView banner;
  private Music music;
  private Updater updater;
  private long backAt = 0, upAt = 0; private int ups = 0;

  private final Runnable reload = () -> { if (web != null) web.loadUrl(BuildConfig.PAGE); };
  private final Runnable hideBanner = () -> banner.setVisibility(View.GONE);

  @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    root = new FrameLayout(this);
    root.setBackgroundColor(0xFFF2F2F7);
    makeWeb();
    banner = new TextView(this);
    banner.setTextColor(Color.WHITE); banner.setTextSize(20); banner.setGravity(Gravity.CENTER);
    banner.setBackgroundColor(0xE61D1D1F); banner.setPadding(40, 24, 40, 24); banner.setVisibility(View.GONE);
    FrameLayout.LayoutParams bl = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL); bl.bottomMargin = 40;
    root.addView(banner, bl);
    setContentView(root);
    immersive();
    music = new Music(this, new Music.Ui() {
      @Override public void now(JSONObject t, String how) { js("window.razNow&&razNow(" + t.toString() + ")"); }
      @Override public void js(String code) { CehActivity.this.js(code); }
    });
    web.loadUrl(BuildConfig.PAGE);
    updater = new Updater(this, t -> { if (music != null) music.note(t); }, this::banner); updater.start();
    try {   // после обновления по воздуху — показать, что новая версия встала
      android.content.SharedPreferences sp = getSharedPreferences("app", MODE_PRIVATE); int was = sp.getInt("ver", 0);
      if (was != 0 && was < BuildConfig.VERSION_CODE) h.postDelayed(() -> banner("Обновлено до версии " + BuildConfig.VERSION_NAME + " ✓", -1, 12000), 4000);
      sp.edit().putInt("ver", BuildConfig.VERSION_CODE).apply();
    } catch (Exception ignored) {}
    // чтобы экран сам включался после перезагрузки приставки
    try { if (!Settings.canDrawOverlays(this)) startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) {}
  }

  @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
  private void makeWeb() {
    web = new WebView(this);
    web.setBackgroundColor(0xFFF2F2F7);
    web.setFocusable(false);
    WebSettings ws = web.getSettings();
    ws.setJavaScriptEnabled(true);
    ws.setDomStorageEnabled(true);          // здесь хранится ключ экрана после подключения по QR
    ws.setDatabaseEnabled(true);
    ws.setMediaPlaybackRequiresUserGesture(false);
    ws.setUseWideViewPort(true); ws.setLoadWithOverviewMode(true);
    ws.setTextZoom(100);
    web.addJavascriptInterface(new Bridge(), "RazApp");
    web.setWebViewClient(new WebViewClient() {
      @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        if (r.isForMainFrame()) { banner("Нет интернета — пробую снова через 30 секунд", -1, 28000); h.removeCallbacks(reload); h.postDelayed(reload, 30000); }
      }
      @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
        // движок страницы упал (нехватка памяти) — пересоздаём его
        try { root.removeView(web); web.destroy(); } catch (Exception ignored) {}
        makeWeb(); web.loadUrl(BuildConfig.PAGE); return true;
      }
    });
    root.addView(web, 0, new FrameLayout.LayoutParams(-1, -1));
  }

  private class Bridge {
    @JavascriptInterface public void log(String t) { h.post(() -> { if (music != null) music.note(t); }); }
    @JavascriptInterface public void music(String json) { h.post(() -> { try { if (music != null) { music.settings(new JSONObject(json)); music.announce(); } } catch (Exception ignored) {} }); }
  }

  private void js(String code) { try { web.evaluateJavascript("try{" + code + "}catch(e){}", null); } catch (Exception ignored) {} }

  void banner(String t, int pct, long hideMs) {
    banner.setText(t); banner.setVisibility(View.VISIBLE);
    h.removeCallbacks(hideBanner); if (hideMs > 0) h.postDelayed(hideBanner, hideMs);
  }

  private void immersive() {
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }
  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }

  @Override public boolean dispatchKeyEvent(KeyEvent e) {
    int k = e.getKeyCode(); boolean up = e.getAction() == KeyEvent.ACTION_UP;
    if (k == KeyEvent.KEYCODE_BACK) {
      if (up) { long now = System.currentTimeMillis(); if (now - backAt < 2000) finish(); else { backAt = now; Toast.makeText(this, "Нажмите «Назад» ещё раз, чтобы выйти", Toast.LENGTH_SHORT).show(); } }
      return true;
    }
    if (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
      if (up && music != null) { String r = music.togglePause(); Toast.makeText(this, "pause".equals(r) ? "Музыка на паузе" : "play".equals(r) ? "Музыка играет" : "Музыка ещё не включилась", Toast.LENGTH_SHORT).show(); }
      return true;
    }
    if (k == KeyEvent.KEYCODE_DPAD_RIGHT || k == KeyEvent.KEYCODE_MEDIA_NEXT) { if (up && music != null) { music.nextTrack(); Toast.makeText(this, "Следующий трек", Toast.LENGTH_SHORT).show(); } return true; }
    if (k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_MEDIA_PREVIOUS) { if (up && music != null) { music.prevTrack(); Toast.makeText(this, "Предыдущий трек", Toast.LENGTH_SHORT).show(); } return true; }
    if (k == KeyEvent.KEYCODE_DPAD_UP) {
      if (up) { long now = System.currentTimeMillis(); ups = now - upAt < 1500 ? ups + 1 : 1; upAt = now;
        if (ups >= 3) { ups = 0; banner("Версия " + BuildConfig.VERSION_NAME + " · проверяю обновления, страница перезагружается", -1, 8000); updater.check(true); h.post(reload); } }
      return true;
    }
    return super.dispatchKeyEvent(e);
  }

  @Override protected void onDestroy() {
    if (updater != null) updater.stop(); if (music != null) music.release(); h.removeCallbacksAndMessages(null);
    try { web.destroy(); } catch (Exception ignored) {}
    super.onDestroy();
  }
}
