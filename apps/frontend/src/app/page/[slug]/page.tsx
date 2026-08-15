"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import LandingBackground from "@/components/LandingBackground";

interface CustomPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  published: boolean;
}

function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 class="text-xl font-bold text-foreground mt-8 mb-3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-2xl font-bold text-foreground mt-10 mb-4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-3xl font-black text-foreground mt-12 mb-6">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-foreground">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-muted-foreground font-light leading-relaxed flex items-start gap-2 mb-2"><span class="w-1.5 h-1.5 rounded-full bg-[var(--lp-accent,#f59e0b)] mt-2 flex-shrink-0"></span><span>$1</span></li>')
    .replace(/\n\n/g, '</p><p class="text-muted-foreground font-light leading-relaxed mb-4">');
}

export default function CustomPageView() {
  const params = useParams();
  const slug = params?.slug as string;
  const [page, setPage] = useState<CustomPage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/public/custom-pages?f_slug=${encodeURIComponent(slug)}&f_published=true`)
      .then((r) => r.json())
      .then((json) => {
        const rows = json.data || [];
        setPage(rows[0] || null);
      })
      .catch(() => setPage(null))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <main className="min-h-screen relative overflow-hidden flex flex-col items-center pt-24">
        <LandingBackground />
        <Navbar />
        <div className="relative z-10 flex items-center justify-center min-h-[60vh]">
          <div className="animate-pulse text-muted-foreground font-light text-lg">Loading…</div>
        </div>
      </main>
    );
  }

  if (!page) {
    return (
      <main className="min-h-screen relative overflow-hidden flex flex-col items-center pt-24">
        <LandingBackground />
        <Navbar />
        <div className="relative z-10 flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
          <h1 className="text-4xl font-bold text-foreground mb-4">Page Not Found</h1>
          <p className="text-muted-foreground mb-8">The page you&apos;re looking for doesn&apos;t exist.</p>
          <Link href="/" className="px-6 py-3 rounded-xl bg-foreground text-background font-semibold hover:scale-105 transition-transform">
            ← Back Home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center pt-24">
      <LandingBackground />
      <Navbar />

      <article className="relative z-10 w-full max-w-4xl mx-auto px-6 py-12">
        <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition text-sm font-medium mb-8">
          <ArrowLeft className="w-4 h-4" /> Back Home
        </Link>

        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground mb-10 leading-tight">
          {page.title}
        </h1>

        <div
          className="prose prose-invert max-w-none text-muted-foreground leading-relaxed"
          dangerouslySetInnerHTML={{ __html: `<p class="text-muted-foreground font-light leading-relaxed mb-4">${renderMarkdown(page.content)}</p>` }}
        />
      </article>

      <footer className="relative z-10 w-full px-6 py-12 max-w-7xl mx-auto border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 text-gray-500 text-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2">
          <span className="text-foreground font-bold tracking-tight">LifeCare</span>
          <span>© 2026 AI Powered Assisted Living.</span>
        </div>
        <Link href="/" className="hover:text-foreground transition-colors">← Back to Home</Link>
      </footer>
    </main>
  );
}
