package com.renote.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android's WebView ignores window.print(), so the app hands its printable HTML here: it is
 * rendered in an off-screen WebView and sent to the system print dialog ("Save as PDF").
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {
    /** Held so the WebView isn't garbage-collected before printing finishes. */
    private WebView printView;

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        String title = call.getString("title", "reNote");
        if (html == null) {
            call.reject("html is required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            printView = new WebView(getActivity());
            printView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    printManager.print(title, view.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
                    call.resolve();
                }
            });
            printView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
