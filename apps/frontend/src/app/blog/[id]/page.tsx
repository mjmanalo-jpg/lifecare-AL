"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, User, Clock } from "lucide-react";
import Navbar from "@/components/Navbar";
import LandingBackground from "@/components/LandingBackground";

interface BlogPost {
  id: string;
  title: string;
  description: string;
  content?: string;
  imageUrl?: string;
  author: string;
  publishedAt: string;
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
    .replace(/\n\n/g, '</p><p class="text-muted-foreground font-light leading-relaxed mb-4">')
    .replace(/^(.+)$/gm, (line) => {
      if (line.startsWith("<")) return line;
      return line;
    });
}

export default function BlogPostPage() {
  const params = useParams();
  const id = params?.id as string;
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/public/blog-posts/${id}`)
      .then((r) => r.json())
      .then((json) => setPost(json.data || null))
      .catch(() => setPost(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="min-h-screen relative overflow-hidden flex flex-col items-center pt-24">
        <LandingBackground />
        <Navbar />
        <div className="relative z-10 flex items-center justify-center min-h-[60vh]">
          <div className="animate-pulse text-muted-foreground font-light text-lg">Loading article…</div>
        </div>
      </main>
    );
  }

  if (!post) {
    return (
      <main className="min-h-screen relative overflow-hidden flex flex-col items-center pt-24">
        <LandingBackground />
        <Navbar />
        <div className="relative z-10 flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
          <h1 className="text-4xl font-bold text-foreground mb-4">Post Not Found</h1>
          <p className="text-muted-foreground mb-8">The article you&apos;re looking for doesn&apos;t exist or has been removed.</p>
          <Link href="/" className="px-6 py-3 rounded-xl bg-foreground text-background font-semibold hover:scale-105 transition-transform">
            ← Back Home
          </Link>
        </div>
      </main>
    );
  }

  const readTime = Math.max(1, Math.ceil((post.content?.split(/\s+/).length || 0) / 200));

  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center pt-24">
      <LandingBackground />
      <Navbar />

      <article className="relative z-10 w-full max-w-4xl mx-auto px-6 py-12">
        {/* Back link */}
        <Link href="/#blog" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition text-sm font-medium mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to Blog
        </Link>

        {/* Hero image */}
        {post.imageUrl && (
          <div className="relative w-full aspect-[21/9] rounded-3xl overflow-hidden mb-10 glass-panel p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrl} alt={post.title} className="w-full h-full object-cover rounded-2xl" />
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
          </div>
        )}

        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground mb-6 leading-tight">
          {post.title}
        </h1>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-10 pb-10 border-b border-white/10">
          <span className="flex items-center gap-2">
            <User className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" />
            {post.author}
          </span>
          <span className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" />
            {new Date(post.publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </span>
          <span className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" />
            {readTime} min read
          </span>
        </div>

        {/* Description */}
        <p className="text-lg text-muted-foreground font-light leading-relaxed mb-10 italic">
          {post.description}
        </p>

        {/* Content */}
        {post.content && (
          <div
            className="prose prose-invert max-w-none text-muted-foreground leading-relaxed"
            dangerouslySetInnerHTML={{ __html: `<p class="text-muted-foreground font-light leading-relaxed mb-4">${renderMarkdown(post.content)}</p>` }}
          />
        )}
      </article>

      {/* Footer */}
      <footer className="relative z-10 w-full px-6 py-12 max-w-7xl mx-auto border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 text-gray-500 text-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2">
          <span className="text-foreground font-bold tracking-tight">Golden Hearth</span>
          <span>© 2026 AI Powered Assisted Living.</span>
        </div>
        <Link href="/" className="hover:text-foreground transition-colors">← Back to Home</Link>
      </footer>
    </main>
  );
}
