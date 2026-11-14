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

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    view = new GeckoView(this);
    setContentView(view);
    if (runtime == null) runtime = GeckoRuntime.create(getApplicationContext());
    open();
    askAutostart();
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
        h.removeCallbacks(reload); h.postDelayed(reload, 10000);   // нет сети — пробуем снова через 10 сек
        return null;
      }
    });
    session.setContentDelegate(new GeckoSession.ContentDelegate() {
      @Override public void onCrash(GeckoSession s) { h.post(MainActivity.this::open); }
      @Override public void onKill(GeckoSession s) { h.post(MainActivity.this::open); }
    });
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
