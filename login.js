// FollowSuggestedWithCookies.java

import com.microsoft.playwright.*;
import com.microsoft.playwright.options.Cookie;

import java.util.*;
import java.util.concurrent.ThreadLocalRandom;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

public class FollowSuggestedWithCookies {
    private static final String SUGGERITI_URL = "https://www.instagram.com/explore/people/";
    private static final String ENV_COOKIES = "INSTAGRAM_COOKIES";
    private static final int MAX_FOLLOW = 70;
    private static final int MAX_TENTATIVI_FALLITI = 10;

    public static void main(String[] args) {
        String cookiesJson = System.getenv(ENV_COOKIES);
        if (cookiesJson == null || cookiesJson.isEmpty()) {
            System.out.println("Errore: variabile di ambiente INSTAGRAM_COOKIES mancante.");
            return;
        }

        try (Playwright playwright = Playwright.create()) {
            Browser browser = playwright.chromium().launch(
                    new BrowserType.LaunchOptions().setHeadless(true)
            );

            Browser.NewContextOptions ctxOptions = new Browser.NewContextOptions()
                    .setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                            "AppleWebKit/537.36 (KHTML, like Gecko) " +
                            "Chrome/120.0.0.0 Safari/537.36");

            BrowserContext context = browser.newContext(ctxOptions);

            boolean ok = caricaCookies(context, cookiesJson);
            if (!ok) {
                browser.close();
                return;
            }

            Page page = context.newPage();
            seguiAccountSuggeriti(page);

            browser.close();
        } catch (Exception e) {
            System.out.println("Errore imprevisto: " + e.getMessage());
        }
    }

    // ---- Parte 1: caricare i cookie ----
    private static boolean caricaCookies(BrowserContext context, String cookiesJson) {
        try {
            Gson gson = new Gson();
            List<Map<String, Object>> cookiesList =
                    gson.fromJson(cookiesJson, new TypeToken<List<Map<String, Object>>>() {}.getType());

            List<Cookie> cookies = new ArrayList<>();

            for (Map<String, Object> c : cookiesList) {
                Cookie cookie = new Cookie();
                cookie.setName((String) c.get("name"));
                cookie.setValue((String) c.get("value"));

                Object url = c.get("url");
                Object domain = c.get("domain");
                Object path = c.get("path");

                if (url != null) {
                    cookie.setUrl((String) url);
                } else {
                    if (domain != null) cookie.setDomain((String) domain);
                    if (path != null) cookie.setPath((String) path);
                }

                if (c.get("expires") != null) {
                    double exp = ((Number) c.get("expires")).doubleValue();
                    cookie.setExpires(exp);
                }
                if (c.get("httpOnly") != null) {
                    cookie.setHttpOnly((Boolean) c.get("httpOnly"));
                }
                if (c.get("secure") != null) {
                    cookie.setSecure((Boolean) c.get("secure"));
                }
                if (c.get("sameSite") != null) {
                    // Puoi mappare i valori se necessario
                }

                cookies.add(cookie);
            }

            context.addCookies(cookies);
            System.out.println("Cookie caricati con successo (" + cookies.size() + " cookie).");
            return true;
        } catch (Exception e) {
            System.out.println("Errore nel caricamento dei cookie: " + e.getMessage());
            return false;
        }
    }

    // ---- Parte 2: chiudere popup ----
    private static void chiudiPopup(Page page) {
        try {
            page.keyboard().press("Escape");
            sleep(500);

            String[] testi = {"Non ora", "Not Now", "Chiudi", "Close", "Cancel"};
            for (String t : testi) {
                Locator btn = page.locator("button", new Page.LocatorOptions().setHasText(t));
                if (btn.count() > 0 && btn.first().isVisible()) {
                    btn.first().click(new Locator.ClickOptions().setTimeout(3000));
                    sleep(500);
                    break;
                }
            }
        } catch (Exception ignored) {
        }
    }

    // ---- Parte 3: trovare i bottoni Segui/Follow ----
    private static List<Locator> trovaBottoniSegui(Page page) {
        String selector =
                "#mount_0_0_T8 > div > div > div.x9f619.x1n2onr6.x1ja2u2z > div > div > " +
                "div.x78zum5.xdt5ytf.x1t2pt76.x1n2onr6.x1ja2u2z.x10cihs4 > " +
                "div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69." +
                "x1c1uobl.x9f619.x16ye13r.xvbhtw8.x78zum5.x15mokao.x1ga7v0g.x16uus16." +
                "xbiv7yw.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.x1q0g3np.xqjyukv." +
                "x1qjc9v5.x1oa3qoh.x1qughib > div.x10o80wk.x14k21rp.xh8yej3 > section > " +
                "main > div > div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xyri2b." +
                "x1c1uobl.x9f619.xjbqb8w.x78zum5.x15mokao.x1ga7v0g.x16uus16.xbiv7yw." +
                "xwib8y2.x1y1aw1k.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.xdt5ytf." +
                "xqjyukv.x1qjc9v5.x1oa3qoh.x1nhvcw1 > div > div > div:nth-child(2) > " +
                "div > div > div > div:nth-child(3) > div > button";

        Locator locatorSeg = page.locator(selector + ":has-text(\"Segui\")");
        Locator locatorFollow = page.locator(selector + ":has-text(\"Follow\")");

        int countSeg = locatorSeg.count();
        int countFollow = locatorFollow.count();
        System.out.println("Bottoni Segui: " + countSeg + ", Bottoni Follow: " + countFollow);

        List<Locator> bottoni = new ArrayList<>();
        for (int i = 0; i < countSeg; i++) bottoni.add(locatorSeg.nth(i));
        for (int i = 0; i < countFollow; i++) bottoni.add(locatorFollow.nth(i));

        return bottoni;
    }

    // ---- Parte 4: logica principale (segui suggeriti) ----
    private static void seguiAccountSuggeriti(Page page) {
        System.out.println("Navigo sulla pagina degli account suggeriti...");
        page.navigate(SUGGERITI_URL, new Page.NavigateOptions().setTimeout(60000));
        page.waitForTimeout(5000);

        if (page.url().contains("accounts/login")) {
            System.out.println("Errore: non loggato. I cookie potrebbero essere scaduti.");
            return;
        }

        System.out.println("Login confermato tramite cookie. Inizio follow...");
        int seguiti = 0;
        int tentativiFalliti = 0;

        while (seguiti < MAX_FOLLOW) {
            try {
                chiudiPopup(page);

                List<Locator> bottoni = trovaBottoniSegui(page);

                if (bottoni.isEmpty()) {
                    System.out.println("Nessun bottone Segui trovato. Ricarico la pagina...");
                    page.navigate(SUGGERITI_URL, new Page.NavigateOptions().setTimeout(60000));
                    page.waitForTimeout(4000);
                    tentativiFalliti++;
                    if (tentativiFalliti >= MAX_TENTATIVI_FALLITI) {
                        System.out.println("Troppi tentativi falliti. Uscita.");
                        break;
                    }
                    continue;
                }

                boolean cliccato = false;
                for (Locator bottone : bottoni) {
                    try {
                        chiudiPopup(page);
                        bottone.scrollIntoViewIfNeeded();
                        bottone.click(new Locator.ClickOptions()
                                .setTimeout(3000)
                                .setForce(true));
                        page.waitForTimeout(1000);

                        seguiti++;
                        tentativiFalliti = 0;
                        System.out.println("Seguito account " + seguiti + "/" + MAX_FOLLOW);
                        cliccato = true;

                        sleep(2000);

                        if (seguiti % 5 == 0) {
                            page.reload();
                            page.waitForTimeout(4000);
                        }

                        break; // torna al while
                    } catch (Exception e) {
                        System.out.println("Errore click bottone: " + e.getMessage());
                        chiudiPopup(page);
                    }
                }

                if (!cliccato) {
                    tentativiFalliti++;
                    System.out.println("Nessun bottone cliccabile trovato (tentativo " + tentativiFalliti + ")");
                    page.keyboard().press("End");
                    sleep(2000);
                    if (tentativiFalliti >= MAX_TENTATIVI_FALLITI) {
                        page.navigate(SUGGERITI_URL, new Page.NavigateOptions().setTimeout(60000));
                        page.waitForTimeout(4000);
                        tentativiFalliti = 0;
                    }
                }
            } catch (Exception e) {
                System.out.println("Errore nel loop principale: " + e.getMessage());
                tentativiFalliti++;
                sleep(2000);
            }
        }

        System.out.println("Operazione completata. Account seguiti oggi: " + seguiti);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {}
    }
}
