'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image, { type ImageProps } from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Quote, X } from 'lucide-react';

import { cn } from '@/lib/utils';

/*
  Retro testimonial cards: aged paper, a sepia portrait, a lowercase line.
  Adapted to the site's single grotesque and ink palette; the paper gradient
  and stain texture are the one place the page is allowed to look old.
*/

export interface iTestimonial {
  name: string;
  designation: string;
  description: string;
  profileImage: string;
}

interface iCarouselProps {
  items: React.ReactElement<{
    testimonial: iTestimonial;
    index: number;
    layout?: boolean;
    onCardClose: () => void;
  }>[];
  initialScroll?: number;
}

const useOutsideClick = (
  ref: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  onOutsideClick: () => void,
) => {
  useEffect(() => {
    if (!active) return;
    const handle = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      onOutsideClick();
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [ref, active, onOutsideClick]);
};

const Carousel = ({ items, initialScroll = 0 }: iCarouselProps) => {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScrollability = () => {
    const el = carouselRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };

  const scrollBy = (dx: number) => carouselRef.current?.scrollBy({ left: dx, behavior: 'smooth' });

  const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768;

  const handleCardClose = (index: number) => {
    if (!carouselRef.current) return;
    const cardWidth = isMobile() ? 320 : 384;
    const gap = 16;
    carouselRef.current.scrollTo({ left: (cardWidth + gap) * index, behavior: 'smooth' });
  };

  useEffect(() => {
    if (carouselRef.current) {
      carouselRef.current.scrollLeft = initialScroll;
      checkScrollability();
    }
  }, [initialScroll]);

  return (
    <div className="relative w-full">
      <div
        className="flex w-full overflow-x-scroll overscroll-x-auto scroll-smooth py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={carouselRef}
        onScroll={checkScrollability}
      >
        <div className="flex flex-row justify-start gap-4 pl-1">
          {items.map((item, index) => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 * index, ease: 'easeOut' }}
              key={`card-${index}`}
              className="last:pr-[5%] md:last:pr-[20%]"
            >
              {React.cloneElement(item, { onCardClose: () => handleCardClose(index) })}
            </motion.div>
          ))}
        </div>
      </div>
      {items.length > 1 && (
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            aria-label="Scroll left"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-canvas transition-colors hover:bg-ink/80 disabled:opacity-40"
            onClick={() => scrollBy(-400)}
            disabled={!canScrollLeft}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-canvas transition-colors hover:bg-ink/80 disabled:opacity-40"
            onClick={() => scrollBy(400)}
            disabled={!canScrollRight}
          >
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
};

const PAPER_TEXTURE =
  'https://cdn.21st.dev/assets/mirror/d1/d1c8cfcf01988d6b7a26c0b6c45429fbdb83e2c126c82752915c620c6f642bd6.jpg';

const TestimonialCard = ({
  testimonial,
  index,
  layout = false,
  onCardClose = () => {},
  backgroundImage = PAPER_TEXTURE,
  stamp,
  detail,
}: {
  testimonial: iTestimonial;
  index: number;
  layout?: boolean;
  onCardClose?: () => void;
  backgroundImage?: string;
  /** A small mark under the designation — provenance, status. */
  stamp?: React.ReactNode;
  /** Extra content shown only in the expanded view. */
  detail?: React.ReactNode;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const wasExpanded = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleExpand = () => setIsExpanded(true);
  const handleCollapse = () => {
    setIsExpanded(false);
    onCardClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCollapse();
    };

    if (isExpanded) {
      wasExpanded.current = true;
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
      document.body.dataset.scrollY = String(scrollY);
      window.addEventListener('keydown', onKey);
    } else if (wasExpanded.current) {
      // Only restore if we actually locked — otherwise every card mounting
      // would scroll the page to the top.
      const scrollY = parseInt(document.body.dataset.scrollY || '0', 10);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    }
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  useOutsideClick(containerRef, isExpanded, handleCollapse);

  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

  return (
    <>
      <AnimatePresence>
        {isExpanded && (
          <div className="fixed inset-0 z-50 h-screen overflow-hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 h-full w-full bg-ink/30 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              ref={containerRef}
              layoutId={layout ? `card-${testimonial.name}` : undefined}
              role="dialog"
              aria-modal="true"
              aria-label={testimonial.name}
              className="relative z-[60] mx-auto h-full max-w-5xl overflow-y-auto rounded-3xl bg-gradient-to-b from-[#f2f0eb] to-[#fff9eb] p-4 md:mt-10 md:p-10"
            >
              <button
                type="button"
                aria-label="Close"
                className="sticky top-4 ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-ink text-canvas"
                onClick={handleCollapse}
              >
                <X className="h-5 w-5" />
              </button>
              <motion.p
                layoutId={layout ? `category-${testimonial.name}` : undefined}
                className="px-0 text-lg text-ink/70 underline underline-offset-8 md:px-20"
              >
                {testimonial.designation}
              </motion.p>
              <motion.p
                layoutId={layout ? `title-${testimonial.name}` : undefined}
                className="mt-4 px-0 text-2xl italic text-ink/80 md:px-20 md:text-4xl"
              >
                {testimonial.name}
              </motion.p>
              {stamp && <div className="mt-3 px-0 md:px-20">{stamp}</div>}
              <div className="px-0 py-8 text-2xl leading-snug text-ink/75 md:px-20 md:text-3xl">
                <Quote className="mb-3 h-6 w-6 text-ink/60" />
                {testimonial.description}
              </div>
              {detail && <div className="px-0 md:px-20">{detail}</div>}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        layoutId={layout ? `card-${testimonial.name}` : undefined}
        onClick={handleExpand}
        aria-label={`Open ${testimonial.name}`}
        className="rounded-3xl text-left"
        whileHover={{
          rotateX: 2,
          rotateY: 2,
          rotate: index % 2 === 0 ? 2 : -2,
          scale: 1.02,
          transition: { duration: 0.3, ease: 'easeOut' },
        }}
      >
        <div className="relative z-10 flex h-[500px] w-80 flex-col items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-b from-[#f2f0eb] to-[#fff9eb] shadow-md md:h-[550px] md:w-96">
          <div className="absolute inset-0 opacity-30" aria-hidden="true">
            <Image
              className="object-cover object-center"
              src={backgroundImage}
              alt=""
              fill
              sizes="384px"
            />
          </div>
          <ProfileImage src={testimonial.profileImage} alt={testimonial.name} />
          <motion.p
            layoutId={layout ? `title-${testimonial.name}` : undefined}
            className="mt-4 px-5 text-center text-xl leading-snug text-ink/75 [text-wrap:balance] md:text-2xl"
          >
            {short(testimonial.description, 100)}
          </motion.p>
          <motion.p
            layoutId={layout ? `category-${testimonial.name}` : undefined}
            className="mt-5 px-5 text-center text-lg italic text-ink/80 md:text-xl"
          >
            {testimonial.name}
          </motion.p>
          <p className="mt-1 text-center text-sm italic text-ink/60 underline decoration-1 underline-offset-8">
            {short(testimonial.designation, 28)}
          </p>
          {stamp && <div className="relative z-20 mt-5">{stamp}</div>}
        </div>
      </motion.button>
    </>
  );
};

const ProfileImage = ({ src, alt, ...rest }: ImageProps) => {
  const [isLoading, setLoading] = useState(true);

  return (
    <div className="relative aspect-square h-[90px] w-[90px] flex-none overflow-hidden rounded-full border-[3px] border-solid border-[rgba(59,59,59,0.6)] opacity-80 saturate-[0.2] sepia-[0.46] md:h-[150px] md:w-[150px]">
      <Image
        className={cn(
          'absolute inset-0 z-20 rounded-full object-cover transition duration-300',
          isLoading ? 'blur-sm' : 'blur-0',
        )}
        onLoad={() => setLoading(false)}
        src={src}
        fill
        sizes="150px"
        loading="lazy"
        decoding="async"
        alt={alt || 'Profile image'}
        {...rest}
      />
    </div>
  );
};

export { Carousel, TestimonialCard, ProfileImage };
