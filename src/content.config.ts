import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
	// Load data from the blog directory
	loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: "./src/content/blog" }),
	// Type-check frontmatter using a schema
	schema: z.object({
		title: z.string(),
		description: z.string(),
		// Transform string to Date object
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		heroImage: z.string().optional(),
	}),
});

const recommendations = defineCollection({
	loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: "./src/content/recommendations" }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
		category: z.string(),
		items: z.array(z.object({
			title: z.string(),
			benefit: z.string(),
			steps: z.array(z.string()),
			recommendation: z.string(),
			type: z.enum(['promo', 'link', 'other']),
			isTop: z.boolean().optional(),
			code: z.string().optional(),
			link: z.string().optional(),
			linkText: z.string().optional(),
		}))
	})
});

export const collections = { blog, recommendations };
