import { DashboardPage } from "@/components/DashboardPage";

type PageProps = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Server entry — unwrap Next.js 16 async route props before rendering client UI. */
export default async function Page({ params, searchParams }: PageProps) {
  await params;
  await searchParams;
  return <DashboardPage />;
}
