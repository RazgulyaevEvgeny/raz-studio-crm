package kz.raz.tv;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.graphics.Color;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import android.widget.Toast;

import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebRequestError;

/** Киоск: экран студии на весь экран на собственном движке (GeckoView), звук без нажатий, автоповтор при сбоях. */
public class MainActivity extends Activity {
  static final String URL = "https://razgulyaevevgeny.github.io/raz-studio-crm/tv.html?app=1";
  private static GeckoRuntime runtime;
  private GeckoView view;
  private GeckoSession session;
  private final Handler h = new Handler(Looper.getMainLooper());
  private final Runnable reload = this::load;
  private long backAt;
  private TextView status;
  private boolean loaded;
  private void say(String t){ h.post(() -> { status.setText(t); status.setVisibility(t.isEmpty() ? View.GONE : View.VISIBLE); }); }

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    view = new GeckoView(this);
    view.setBackgroundColor(Color.BLACK);
    try { view.coverUntilFirstPaint(Color.BLACK); } catch (Throwable ignored) {}
    // на многих ТВ-приставках обычный SurfaceView даёт пустой белый/чёрный экран — рисуем через TextureView
    try { view.setViewBackend(GeckoView.BACKEND_TEXTURE_VIEW); } catch (Throwable ignored) {}
    root.addView(view, new FrameLayout.LayoutParams(-1, -1));
    status = new TextView(this);
    status.setTextColor(0xFFEBEBF5); status.setTextSize(22); status.setGravity(Gravity.CENTER);
    status.setBackgroundColor(Color.BLACK); status.setPadding(60, 60, 60, 60);
    root.addView(status, new FrameLayout.LayoutParams(-1, -1));
    setContentView(root);
    say("Студия запускается…");
    if (runtime == null) runtime = GeckoRuntime.create(getApplicationContext(),
        new GeckoRuntimeSettings.Builder().consoleOutput(true).aboutConfigEnabled(false)
            // свой поиск адресов сайтов (через 1.1.1.1), если системный на приставке не отвечает; без IPv6
            .trustedRecursiveResolverMode(GeckoRuntimeSettings.TRR_MODE_FIRST)
            .trustedRecursiveResolverUri("https://1.1.1.1/dns-query")
            .configFilePath(writeConfig())
            .build());
    open();
    askAutostart();
  }

  /** Настройки движка: выключаем IPv6 — на приставках с 4G-роутером он часто ломает поиск адресов. */
  private String writeConfig() {
    try {
      java.io.File f = new java.io.File(getFilesDir(), "geckoview-config.yaml");
      try (java.io.FileWriter w = new java.io.FileWriter(f)) { w.write("prefs:\n  network.dns.disableIPv6: true\n  network.dns.native_https_query: false\n"); }
      return f.getAbsolutePath();
    } catch (Exception e) { return ""; }
  }

  private void open() {
    if (session != null) { try { session.close(); } catch (Exception ignored) {} }
    session = new GeckoSession();
    session.setPermissionDelegate(new GeckoSession.PermissionDelegate() {
      @Override public GeckoResult<Integer> onContentPermissionRequest(GeckoSession s, ContentPermission p) {
        boolean sound = p.permission == PERMISSION_AUTOPLAY_AUDIBLE || p.permission == PERMISSION_AUTOPLAY_INAUDIBLE;
        return GeckoResult.fromValue(sound ? ContentPermission.VALUE_ALLOW : ContentPermission.VALUE_DENY);
      }
    });
    session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
      @Override public GeckoResult<String> onLoadError(GeckoSession s, String uri, WebRequestError e) {
        boolean main = uri == null || uri.startsWith("https://razgulyaevevgeny.github.io/");
        if (!main && loaded) return null;   // сбой вложенной ссылки при работающем экране — не трогаем
        loaded = false;
        String why = e.code == WebRequestError.ERROR_UNKNOWN_HOST ? "приставка не нашла адрес сайта (DNS)"
            : e.code == WebRequestError.ERROR_OFFLINE ? "нет интернета"
            : e.code == WebRequestError.ERROR_NET_TIMEOUT ? "сайт долго не отвечает"
            : "ошибка 0x" + Integer.toHexString(e.code);
        say("Не удалось загрузить экран: " + why + ".\nПробую снова через 10 секунд.");
        h.removeCallbacks(reload); h.postDelayed(reload, 10000);
        return null;
      }
    });
    session.setContentDelegate(new GeckoSession.ContentDelegate() {
      @Override public void onFirstContentfulPaint(GeckoSession s) { loaded = true; h.postDelayed(() -> say(""), 300); }
      @Override public void onCrash(GeckoSession s) { loaded = false; say("Движок перезапускается…"); h.post(MainActivity.this::open); }
      @Override public void onKill(GeckoSession s) { h.post(MainActivity.this::open); }
    });
    session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
      @Override public void onPageStart(GeckoSession s, String url) { if (!loaded) say("Загружаю экран…"); }
      @Override public void onProgressChange(GeckoSession s, int p) {
        if (loaded) return;
        // страница держит открытые соединения (музыка, обновления), поэтому «загрузка окончена» может не прийти — открываем экран на 100%
        if (p >= 100) { loaded = true; h.postDelayed(() -> say(""), 800); } else say("Загружаю экран… " + p + "%");
      }
      @Override public void onPageStop(GeckoSession s, boolean ok) {
        if (ok) { loaded = true; h.postDelayed(() -> say(""), 600); }
      }
    });
    h.postDelayed(() -> { if (!loaded) say("Экран долго не загружается.\nНажмите «Меню» на пульте, чтобы перезагрузить."); }, 40000);
    session.open(runtime);
    view.setSession(session);
    view.requestFocus();
    load();
  }

  private void load() {
    if (session == null) return;
    session.load(new GeckoSession.Loader().uri(URL).flags(GeckoSession.LOAD_FLAGS_BYPASS_CACHE));
  }

  /** Android 10+ пускает автозапуск после включения только с разрешением «поверх других приложений». */
  private void askAutostart() {
    try {
      if (!Settings.canDrawOverlays(this))
        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
    } catch (Exception ignored) {}
  }

  @Override public boolean dispatchKeyEvent(KeyEvent e) {
    int k = e.getKeyCode();
    if (k == KeyEvent.KEYCODE_BACK) {            // «Назад» дважды — выйти
      if (e.getAction() == KeyEvent.ACTION_UP) {
        long now = System.currentTimeMillis();
        if (now - backAt < 2000) finish();
        else { backAt = now; Toast.makeText(this, "Нажмите «Назад» ещё раз, чтобы выйти", Toast.LENGTH_SHORT).show(); }
      }
      return true;
    }
    if (k == KeyEvent.KEYCODE_MENU) {            // «Меню» — перезагрузить экран
      if (e.getAction() == KeyEvent.ACTION_UP) load();
      return true;
    }
    return super.dispatchKeyEvent(e);
  }

  @Override public void onWindowFocusChanged(boolean f) {
    super.onWindowFocusChanged(f);
    if (f) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }
}
