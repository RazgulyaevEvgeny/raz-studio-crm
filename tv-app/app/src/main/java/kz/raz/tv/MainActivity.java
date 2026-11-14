package kz.raz.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Outline;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.OvershootInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.animation.PropertyValuesHolder;
import android.graphics.drawable.GradientDrawable;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * «Студия» — экран для ТВ-приставки.
 * Страница экрана работает за кадром (музыка, данные из CRM, вёрстка) и отдаёт готовые слои-картинки:
 * фон, шапку и каждую карточку. Показывает и двигает их сама система Android, а видео играет
 * аппаратный плеер приставки — как в обычных видеоприложениях. Браузер в анимации не участвует.
 */
public class MainActivity extends Activity {
  static final String PAGE = "https://razgulyaevevgeny.github.io/raz-studio-crm/tv.html?app=2";

  private final Handler h = new Handler(Looper.getMainLooper());
  private WebView web;
  private ImageView bgV, chromeV;
  private FrameLayout cardsV;
  private TextView status;
  private View prog;
  private long slideAt, slideMs;
  private ObjectAnimator bgAnim;
  private Bitmap scratch;
  private long backAt;

  private int count = 0, cur = -1;
  private boolean due = true, started = false;
  private Scene pending, building;
  private final List<Vid> vids = new ArrayList<>();
  private final Set<String> loading = new HashSet<>();

  static class Card { int x, y, w, hh, rad, idx; Bitmap a, b; String vid, vurl; int vx, vy, vw, vh; }
  static class Scene { int i; double sec = 20; String anim = "spring"; int shift = 40; List<Card> cards = new ArrayList<>(); }

  private final Runnable fire = () -> { due = true; if (pending != null) showPending(); };
  private final Runnable askNext = () -> { if (count > 1) js("razScene(" + ((cur + 1) % count) + ")"); };
  private final Runnable reload = () -> web.loadUrl(PAGE);

  @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    web = new WebView(this);
    web.setBackgroundColor(Color.TRANSPARENT);
    web.setLayerType(View.LAYER_TYPE_SOFTWARE, null);   // страница только готовит картинки; рисовать её видеокартой не нужно
    web.setFocusable(false);
    WebSettings ws = web.getSettings();
    ws.setJavaScriptEnabled(true);
    ws.setDomStorageEnabled(true);
    ws.setDatabaseEnabled(true);
    ws.setMediaPlaybackRequiresUserGesture(false);       // музыка без нажатия кнопки
    ws.setLoadWithOverviewMode(false);
    ws.setUseWideViewPort(false);
    web.addJavascriptInterface(new Bridge(), "RazApp");
    web.setWebViewClient(new WebViewClient() {
      @Override public void onReceivedError(WebView v, WebResourceRequest rq, WebResourceError er) {
        if (rq != null && rq.isForMainFrame() && !started) {
          say("Не удалось загрузить экран. Проверьте интернет.\nПробую снова через 10 секунд.");
          h.removeCallbacks(reload); h.postDelayed(reload, 10000);
        }
      }
    });
    root.addView(web, new FrameLayout.LayoutParams(-1, -1));

    bgV = new ImageView(this); bgV.setScaleType(ImageView.ScaleType.FIT_XY); bgV.setBackgroundColor(Color.BLACK);
    root.addView(bgV, new FrameLayout.LayoutParams(-1, -1));
    // фон чуть больше экрана и очень медленно плывёт — один слой, приставке это ничего не стоит
    bgV.setScaleX(1.12f); bgV.setScaleY(1.12f);
    bgAnim = ObjectAnimator.ofPropertyValuesHolder(bgV, PropertyValuesHolder.ofFloat(View.TRANSLATION_X, -40f, 40f), PropertyValuesHolder.ofFloat(View.TRANSLATION_Y, 22f, -22f), PropertyValuesHolder.ofFloat(View.SCALE_X, 1.12f, 1.18f), PropertyValuesHolder.ofFloat(View.SCALE_Y, 1.12f, 1.18f));
    bgAnim.setDuration(36000); bgAnim.setRepeatCount(ValueAnimator.INFINITE); bgAnim.setRepeatMode(ValueAnimator.REVERSE); bgAnim.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator());
    bgAnim.start();
    cardsV = new FrameLayout(this);
    root.addView(cardsV, new FrameLayout.LayoutParams(-1, -1));
    chromeV = new ImageView(this); chromeV.setScaleType(ImageView.ScaleType.FIT_XY);
    root.addView(chromeV, new FrameLayout.LayoutParams(-1, -1));

    prog = new View(this); prog.setVisibility(View.GONE); prog.setPivotX(0);
    root.addView(prog, new FrameLayout.LayoutParams(1, 1));
    status = new TextView(this);
    status.setTextColor(0xFFEBEBF5); status.setTextSize(22); status.setGravity(Gravity.CENTER);
    status.setBackgroundColor(Color.BLACK); status.setPadding(60, 60, 60, 60);
    root.addView(status, new FrameLayout.LayoutParams(-1, -1));
    setContentView(root);
    say("Студия запускается…");
    h.postDelayed(() -> { if (!started) say("Экран долго не загружается.\nНажмите «Меню» на пульте, чтобы перезагрузить."); }, 60000);
    web.loadUrl(PAGE);
    askAutostart();
  }

  private void say(String t) { status.setText(t); status.setVisibility(t.isEmpty() ? View.GONE : View.VISIBLE); }
  private void js(String code) { try { web.evaluateJavascript("try{" + code + "}catch(e){}", null); } catch (Exception ignored) {} }

  /** Мост: страница сообщает, что слой готов к съёмке. */
  class Bridge {
    @JavascriptInterface public void built(String json) { h.post(() -> onBuilt(json)); }
    @JavascriptInterface public void shot(String kind, String json) { h.post(() -> { try { onShot(kind, json); } catch (Throwable t) { /* слой пропустим */ } js("window.razAck&&razAck()"); }); }
    @JavascriptInterface public void chromeChanged() { h.post(() -> { if (cur >= 0) js("razChrome(" + cur + ")"); }); }
  }

  private void onBuilt(String json) {
    try { count = new JSONObject(json).optInt("n", 0); } catch (Exception e) { count = 0; }
    h.removeCallbacks(fire); h.removeCallbacks(askNext);
    pending = null; building = null; due = true; cur = -1;
    if (count > 0) js("razBg();razChrome(0);razScene(0)");
  }

  private Bitmap grab() {
    int w = web.getWidth(), hh = web.getHeight();
    if (w <= 0 || hh <= 0) return null;
    if (scratch == null || scratch.getWidth() != w || scratch.getHeight() != hh) scratch = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
    scratch.eraseColor(Color.TRANSPARENT);
    web.draw(new Canvas(scratch));
    return scratch;
  }

  private Bitmap crop(Bitmap src, int x, int y, int w, int hh) {
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(w, src.getWidth() - x); hh = Math.min(hh, src.getHeight() - y);
    if (w <= 0 || hh <= 0) return null;
    return Bitmap.createBitmap(src, x, y, w, hh);
  }

  private void onShot(String kind, String json) throws Exception {
    Bitmap s = grab();
    if (s == null) return;
    if ("bg".equals(kind)) { bgV.setImageBitmap(s.copy(Bitmap.Config.ARGB_8888, false)); return; }
    if ("chrome".equals(kind)) {
      chromeV.setImageBitmap(s.copy(Bitmap.Config.ARGB_8888, false));
      try { JSONObject o = new JSONObject(json); JSONArray d = o.optJSONArray("dot"); if (d != null) placeProgress(d.getInt(0), d.getInt(1), d.getInt(2), d.getInt(3), o.optBoolean("dark", true)); } catch (Exception ignored) {}
      return;
    }
    if ("scene".equals(kind)) {
      JSONObject o = new JSONObject(json);
      Scene sc = new Scene();
      sc.i = o.optInt("i"); sc.sec = o.optDouble("sec", 20); sc.anim = o.optString("anim", "spring"); sc.shift = o.optInt("shift", 40);
      JSONArray cs = o.getJSONArray("cards");
      boolean hasVid = false;
      for (int k = 0; k < cs.length(); k++) {
        JSONObject c = cs.getJSONObject(k); JSONArray r = c.getJSONArray("r");
        Card cd = new Card();
        cd.x = r.getInt(0); cd.y = r.getInt(1); cd.w = r.getInt(2); cd.hh = r.getInt(3); cd.rad = c.optInt("rad", 0); cd.idx = c.optInt("i", k);
        cd.a = crop(s, cd.x, cd.y, cd.w, cd.hh);
        JSONObject v = c.optJSONObject("v");
        if (v != null) { JSONArray vr = v.getJSONArray("r"); cd.vid = v.getString("id"); cd.vurl = v.getString("url");
          cd.vx = vr.getInt(0); cd.vy = vr.getInt(1); cd.vw = vr.getInt(2); cd.vh = vr.getInt(3); hasVid = true; fetchVideo(cd.vid, cd.vurl); }
        if (cd.a != null) sc.cards.add(cd);
      }
      if (hasVid) building = sc; else ready(sc);
      return;
    }
    if ("over".equals(kind) && building != null) {
      for (Card cd : building.cards) if (cd.vid != null) cd.b = crop(s, cd.x, cd.y, cd.w, cd.hh);
      Scene sc = building; building = null; ready(sc);
    }
  }

  /** Полоска прогресса текущего слайда: заполняется за время показа. */
  private void placeProgress(int x, int y, int w, int hh, boolean dark) {
    if (w <= 0 || hh <= 0) { prog.setVisibility(View.GONE); return; }
    FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) prog.getLayoutParams();
    lp.width = w; lp.height = hh; lp.leftMargin = x; lp.topMargin = y; prog.setLayoutParams(lp);
    GradientDrawable g = new GradientDrawable(); g.setColor(dark ? Color.WHITE : 0xFF007AFF); g.setCornerRadius(hh / 2f); prog.setBackground(g);
    prog.setVisibility(count > 1 ? View.VISIBLE : View.GONE);
    prog.animate().cancel();
    long left = slideMs - (System.currentTimeMillis() - slideAt);
    float done = slideMs > 0 ? Math.max(0f, Math.min(1f, 1f - left / (float) slideMs)) : 1f;
    prog.setScaleX(done);
    if (left > 0) prog.animate().scaleX(1f).setDuration(left).setInterpolator(new LinearInterpolator()).start();
  }

  private void ready(Scene sc) { pending = sc; if (due) showPending(); }

  private void showPending() {
    final Scene sc = pending; pending = null; due = false;
    if (!started) { started = true; say(""); }
    cur = sc.i;
    slideAt = System.currentTimeMillis(); slideMs = (long) (Math.max(5, sc.sec) * 1000);
    prog.animate().cancel(); prog.setScaleX(0f);
    transition(sc);
    js("razChrome(" + cur + ")");
    h.removeCallbacks(fire); h.removeCallbacks(askNext);
    if (count > 1) { h.postDelayed(askNext, 2500); h.postDelayed(fire, (long) (Math.max(5, sc.sec) * 1000)); }
  }

  /** Смена экрана: старые карточки гаснут, новые выезжают по очереди. Двигаются готовые картинки — это дёшево для любой приставки. */
  private void transition(final Scene sc) {
    final List<View> old = new ArrayList<>();
    for (int k = 0; k < cardsV.getChildCount(); k++) old.add(cardsV.getChildAt(k));
    final List<Vid> oldVids = new ArrayList<>(vids); vids.clear();
    int n = 0;
    for (final View v : old) v.animate().alpha(0f).translationY(-sc.shift * 0.6f).scaleX(0.97f).scaleY(0.97f)
        .setDuration(260).setStartDelay(40L * n++).setInterpolator(new AccelerateInterpolator(1.4f)).withEndAction(() -> cardsV.removeView(v)).start();
    h.postDelayed(() -> { for (Vid v : oldVids) v.release(); }, 420);
    h.postDelayed(() -> { for (Card c : sc.cards) addCard(sc, c); }, old.isEmpty() ? 0 : 340);
  }

  private void addCard(Scene sc, final Card c) {
    FrameLayout box = new FrameLayout(this);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(c.w, c.hh); lp.leftMargin = c.x; lp.topMargin = c.y;
    final int rad = c.rad;
    box.setOutlineProvider(new ViewOutlineProvider() { @Override public void getOutline(View v, Outline o) { o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), rad); } });
    box.setClipToOutline(true);
    ImageView a = new ImageView(this); a.setScaleType(ImageView.ScaleType.FIT_XY); a.setImageBitmap(c.a);
    box.addView(a, new FrameLayout.LayoutParams(-1, -1));
    if (c.vid != null) {
      TextureView tv = new TextureView(this);
      FrameLayout.LayoutParams vp = new FrameLayout.LayoutParams(Math.max(2, c.vw), Math.max(2, c.vh)); vp.leftMargin = c.vx - c.x; vp.topMargin = c.vy - c.y;
      tv.setAlpha(0.01f);
      box.addView(tv, vp);
      if (c.b != null) { ImageView bv = new ImageView(this); bv.setScaleType(ImageView.ScaleType.FIT_XY); bv.setImageBitmap(c.b); box.addView(bv, new FrameLayout.LayoutParams(-1, -1)); }
      vids.add(new Vid(c.vid, tv));
    }
    float dx = 0, dy = sc.shift * 1.5f, sc0 = 0.94f; long dur = 720; android.animation.TimeInterpolator ip = new OvershootInterpolator(1.15f);
    switch (sc.anim) {
      case "up": ip = new DecelerateInterpolator(2.2f); dy = sc.shift * 2.4f; sc0 = 1f; dur = 640; break;
      case "left": case "flip": dx = -sc.shift * 3f; dy = 0; sc0 = 1f; ip = new DecelerateInterpolator(2.2f); dur = 640; break;
      case "right": dx = sc.shift * 3f; dy = 0; sc0 = 1f; ip = new DecelerateInterpolator(2.2f); dur = 640; break;
      case "drop": dy = -sc.shift * 2.4f; sc0 = 1f; ip = new OvershootInterpolator(1.3f); break;
      case "zoom": dy = 0; sc0 = 0.82f; ip = new OvershootInterpolator(1.2f); break;
      case "fade": dy = 0; sc0 = 1f; ip = new DecelerateInterpolator(1.5f); dur = 600; break;
      case "none": dy = 0; sc0 = 1f; dur = 1; break;
      default: break;   // spring: снизу с лёгкой пружиной
    }
    box.setAlpha(0f); box.setTranslationX(dx); box.setTranslationY(dy); box.setScaleX(sc0); box.setScaleY(sc0);
    cardsV.addView(box, lp);
    final boolean plain = c.vid == null;
    if (plain) box.setLayerType(View.LAYER_TYPE_HARDWARE, null);   // на время движения карточка — одна текстура
    final FrameLayout fb = box;
    box.animate().translationX(0).translationY(0).scaleX(1f).scaleY(1f).setDuration(dur).setStartDelay(110L * c.idx).setInterpolator(ip)
        .withEndAction(() -> { if (plain) fb.setLayerType(View.LAYER_TYPE_NONE, null); }).start();
    ObjectAnimator fade = ObjectAnimator.ofFloat(box, View.ALPHA, 0f, 1f); fade.setDuration(Math.min(dur, 380)); fade.setStartDelay(110L * c.idx); fade.setInterpolator(new DecelerateInterpolator()); fade.start();
  }

  /** Видео карточки: аппаратный плеер приставки, по кругу, без звука. Файл берётся из памяти приставки. */
  class Vid implements TextureView.SurfaceTextureListener {
    final String id; final TextureView tv; MediaPlayer mp; Surface surface; boolean dead;
    Vid(String id, TextureView tv) { this.id = id; this.tv = tv; tv.setSurfaceTextureListener(this); if (tv.isAvailable()) onSurfaceTextureAvailable(tv.getSurfaceTexture(), tv.getWidth(), tv.getHeight()); }
    File file() { return new File(getFilesDir(), "v_" + id + ".mp4"); }
    void tryStart() {
      if (dead || mp != null || surface == null || !file().exists() || loading.contains(id)) return;
      try {
        mp = new MediaPlayer();
        mp.setDataSource(file().getAbsolutePath());
        mp.setSurface(surface); mp.setLooping(true); mp.setVolume(0f, 0f);
        mp.setOnPreparedListener(p -> { if (dead) return; fit(p.getVideoWidth(), p.getVideoHeight()); p.start(); });
        mp.setOnErrorListener((p, a, b2) -> true);
        mp.prepareAsync();
      } catch (Exception e) { mp = null; }
    }
    void fit(int vw, int vh) {   // заполнить область с обрезкой по центру
      int w = tv.getWidth(), hh = tv.getHeight(); if (vw <= 0 || vh <= 0 || w <= 0 || hh <= 0) return;
      float s = Math.max(w / (float) vw, hh / (float) vh);
      Matrix m = new Matrix(); m.setScale(vw * s / w, vh * s / hh, w / 2f, hh / 2f); tv.setTransform(m);
    }
    void release() { dead = true; try { if (mp != null) { mp.release(); mp = null; } } catch (Exception ignored) {} }
    @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int hh) { surface = new Surface(st); tryStart(); }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int hh) {}
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) { release(); return true; }
    boolean shown;
    @Override public void onSurfaceTextureUpdated(SurfaceTexture st) { if (!shown && mp != null) { shown = true; tv.animate().alpha(1f).setDuration(350).start(); } }
  }

  /** Скачать ролик в память приставки (один раз): в базе он лежит текстом, одной или несколькими частями. */
  private void fetchVideo(final String id, final String url) {
    final File f = new File(getFilesDir(), "v_" + id + ".mp4");
    if (f.exists() || loading.contains(id)) return;
    loading.add(id);
    new Thread(() -> {
      boolean ok = false;
      try {
        JSONObject o = new JSONObject(http(url + ".json"));
        StringBuilder sb = new StringBuilder(o.optString("d", ""));
        int n = Math.max(1, o.optInt("n", 1));
        for (int k = 1; k < n; k++) sb.append((String) new JSONTokener(http(url + "_p" + k + "/d.json")).nextValue());
        int comma = sb.indexOf(",");
        byte[] data = Base64.decode(sb.substring(comma + 1), Base64.DEFAULT);
        File tmp = new File(getFilesDir(), "v_" + id + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(data); }
        ok = tmp.renameTo(f);
      } catch (Throwable ignored) {}
      final boolean done = ok;
      h.post(() -> { loading.remove(id); if (done) for (Vid v : vids) if (v.id.equals(id)) v.tryStart(); });
    }).start();
  }

  private static String http(String u) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
    c.setConnectTimeout(15000); c.setReadTimeout(60000);
    try (InputStream in = c.getInputStream()) {
      ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[65536]; int r;
      while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
      return bo.toString("UTF-8");
    } finally { c.disconnect(); }
  }

  /** Android 10+ пускает автозапуск после включения только с разрешением «поверх других приложений». */
  private void askAutostart() {
    try { if (!Settings.canDrawOverlays(this)) startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) {}
  }

  @Override public boolean dispatchKeyEvent(KeyEvent e) {
    int k = e.getKeyCode(); boolean up = e.getAction() == KeyEvent.ACTION_UP;
    if (k == KeyEvent.KEYCODE_BACK) {
      if (up) { long now = System.currentTimeMillis(); if (now - backAt < 2000) finish(); else { backAt = now; Toast.makeText(this, "Нажмите «Назад» ещё раз, чтобы выйти", Toast.LENGTH_SHORT).show(); } }
      return true;
    }
    if (k == KeyEvent.KEYCODE_MENU) { if (up) { started = false; say("Перезагружаю…"); web.reload(); } return true; }
    if (k == KeyEvent.KEYCODE_DPAD_RIGHT || k == KeyEvent.KEYCODE_MEDIA_NEXT) { if (up) { js("nextTrack()"); Toast.makeText(this, "Следующий трек", Toast.LENGTH_SHORT).show(); } return true; }
    if (k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_MEDIA_PREVIOUS) { if (up) { js("prevTrack()"); Toast.makeText(this, "Предыдущий трек", Toast.LENGTH_SHORT).show(); } return true; }
    return super.dispatchKeyEvent(e);
  }

  @Override protected void onDestroy() { for (Vid v : vids) v.release(); try { web.destroy(); } catch (Exception ignored) {} super.onDestroy(); }

  @Override public void onWindowFocusChanged(boolean f) {
    super.onWindowFocusChanged(f);
    if (f) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }
}
